import { SystemMessage, type BaseMessage } from "@langchain/core/messages";
import {
  AiError,
  citedSourceIds,
  createToolRegistry,
  loadSkillTool,
  resumeOrchestrator,
  runOrchestrator,
  skillsPrompt,
  sourcesPrompt,
  toOrchestratorCheckpoint,
  type ActivityItem,
  type AgentMode,
  type Ai,
  type AiCallContext,
  type OrchestratorOptions,
  type OrchestratorResult,
  type RagPipeline,
  type SkillDefinition,
  type Source,
  type ToolCallRecord,
} from "@tessel/ai";
import type { ChatEvent, ChatMessage } from "@tessel/contracts";
import type { AgentRunRow, MessageSource } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { AppError } from "../../lib/errors";
import type { Response } from "express";
import type { DocumentsService } from "../documents/documents.service";
import type { SkillsService } from "../skills/skills.service";
import type { Actor, ChatService, PreparedReply } from "./chat.service";
import { teamWorkers, workspaceTools } from "./chat.tools";

const HEARTBEAT_MS = 15_000;

/** Writes server-sent events, and knows when the client has gone. */
export function openEventStream(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Tells proxies such as nginx not to buffer the stream.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  // Comments keep idle connections from being closed by proxies.
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
  return {
    send(event: ChatEvent) {
      if (!res.writableEnded) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    },
    end() {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
}

function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof AiError) return { code: error.code, message: error.message };
  return { code: "model_unavailable", message: "The model couldn't finish this reply. Try again" };
}

export interface ReplyDependencies {
  ai: Ai;
  rag: RagPipeline;
  service: ChatService;
  documents: DocumentsService;
  skills: SkillsService;
  logger: Logger;
}

type EventStream = ReturnType<typeof openEventStream>;

interface Drive {
  deps: ReplyDependencies;
  actor: Actor;
  stream: EventStream;
  signal: AbortSignal;
  context: AiCallContext;
  threadId: string;
  messageId: string;
  modelId: string;
  /** Whether the model can call tools; models that can't just answer. */
  canUseTools: boolean;
  /** Skills the agent can load with load_skill. */
  skills: SkillDefinition[];
  /** Collects citation sources: pre-fetched ones first, then any the agent finds. */
  sources: Source[];
  /** Text already written, when continuing a paused reply. */
  initialText: string;
  initialToolCalls: ToolCallRecord[];
  initialActivity: ActivityItem[];
  start: (options: OrchestratorOptions) => Promise<OrchestratorResult>;
  /** After the reply ends, e.g. to name a new thread. */
  after?: () => Promise<void>;
  runId?: string;
}

/** Adds the sources to the system prompt; one system message keeps every provider happy. */
function withSources(history: BaseMessage[], prompt: string): BaseMessage[] {
  const [system, ...rest] = history;
  return [new SystemMessage(`${system?.text ?? ""}\n\n${prompt}`), ...rest];
}

const markCited = (sources: Source[], content: string): MessageSource[] => {
  const cited = new Set(citedSourceIds(content, sources));
  return sources.map((source) => ({ ...source, cited: cited.has(source.id) }));
};

/** Closes stages that can't finish any more, e.g. after stop or an error. */
const settle = (activity: ActivityItem[], status: "failed" | "skipped"): ActivityItem[] =>
  activity.map((item) =>
    item.status === "running"
      ? { ...item, status }
      : item.status === "pending"
        ? { ...item, status: "skipped" }
        : item,
  );

const BLOCKED_REPLY = {
  code: "reply_blocked",
  message: "This reply was removed because it broke the usage policy",
};

/**
 * Runs the orchestrator for one reply and saves the outcome. Tokens, tool
 * calls, and stages stream as they happen; the reply is saved once at the
 * end: complete, waiting for approval (with a checkpoint), stopped, or error.
 * Finished replies are moderated before they're saved.
 */
async function drive(run: Drive): Promise<void> {
  const { deps, actor, stream, signal, context } = run;
  let content = run.initialText;
  let activity = run.initialActivity;
  const toolCalls = new Map(run.initialToolCalls.map((call) => [call.id, call]));
  const tools = run.canUseTools
    ? createToolRegistry(
        workspaceTools({
          documents: deps.documents,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          ...(actor.requestId ? { requestId: actor.requestId } : {}),
          sources: run.sources,
        }).concat(run.skills.length ? [loadSkillTool(run.skills)] : []),
      )
    : createToolRegistry([]);
  const helper = { ...context, feature: "agent" as const };
  const options: OrchestratorOptions = {
    model: deps.ai.chatModel(context, run.modelId),
    thinker: deps.ai.chatModel(helper, run.modelId),
    critic: deps.ai.chatModel(helper, deps.ai.registry.forRole("utility").id, { temperature: 0 }),
    tools,
    workers: teamWorkers,
    context,
    signal,
    logger: deps.logger,
    // Permission and validation errors explain themselves; anything else stays in the logs.
    describeError: (error) =>
      error instanceof AppError && error.status < 500 ? error.message : undefined,
    emit: (event) => {
      if (event.type === "token") {
        content += event.text;
        stream.send({ type: "token", text: event.text });
      } else if (event.type === "tool") {
        toolCalls.set(event.call.id, event.call);
        stream.send({ type: "tool", call: event.call });
      } else {
        activity = event.items;
        stream.send({ type: "activity", items: event.items });
      }
    },
  };
  const finalToolCalls = () => [...toolCalls.values()];
  const reply = { threadId: run.threadId, messageId: run.messageId, modelId: run.modelId };

  try {
    const result = await run.start(options);
    if (result.status === "waiting") {
      const message = await deps.service.pauseReply(actor, reply, {
        content: result.text,
        toolCalls: result.toolCalls,
        sources: markCited(run.sources, result.text),
        activity: result.activity,
        checkpoint: result.checkpoint as unknown as Record<string, unknown>,
      });
      stream.send({ type: "done", status: "waiting", message });
    } else if (!(await allowedOutput(deps, context, result.text))) {
      const assistantMessage = await deps.service.finishReply(actor, run.messageId, {
        content: "",
        status: "error",
        errorCode: BLOCKED_REPLY.code,
        toolCalls: result.toolCalls,
        activity: result.activity,
        sources: [],
      });
      if (run.runId) await deps.service.setRunStatus(actor, run.runId, "completed");
      stream.send({ type: "error", ...BLOCKED_REPLY, assistantMessage });
    } else {
      const message = await deps.service.finishReply(actor, run.messageId, {
        content: result.text,
        status: "complete",
        toolCalls: result.toolCalls,
        activity: result.activity,
        sources: markCited(run.sources, result.text),
      });
      if (run.runId) await deps.service.setRunStatus(actor, run.runId, "completed");
      stream.send({ type: "done", status: "complete", message });
    }
    await run.after?.();
  } catch (error) {
    if (signal.aborted) {
      // The user pressed stop or closed the tab: keep what they already saw.
      await deps.service
        .finishReply(actor, run.messageId, {
          content,
          status: "stopped",
          toolCalls: finalToolCalls(),
          activity: settle(activity, "skipped"),
          sources: markCited(run.sources, content),
        })
        .catch((saveError: unknown) =>
          deps.logger.error({ err: saveError }, "Failed to save a stopped reply"),
        );
      if (run.runId)
        await deps.service.setRunStatus(actor, run.runId, "cancelled").catch(() => undefined);
      if (content) await run.after?.().catch(() => undefined);
      return;
    }
    const { code, message } = publicError(error);
    if (!(error instanceof AiError)) deps.logger.error({ err: error }, "Chat reply failed");
    const assistantMessage = await deps.service
      .finishReply(actor, run.messageId, {
        content,
        status: "error",
        errorCode: code,
        toolCalls: finalToolCalls(),
        activity: settle(activity, "failed"),
        sources: markCited(run.sources, content),
      })
      .catch((saveError: unknown) => {
        deps.logger.error({ err: saveError }, "Failed to save a failed reply");
        return undefined;
      });
    if (run.runId)
      await deps.service.setRunStatus(actor, run.runId, "cancelled").catch(() => undefined);
    stream.send({
      type: "error",
      code,
      message,
      ...(assistantMessage ? { assistantMessage } : {}),
    });
    await run.after?.().catch(() => undefined);
  }
}

/** The workspace's skills; a failure to load them shouldn't cost the reply. */
async function loadSkills(deps: ReplyDependencies, actor: Actor): Promise<SkillDefinition[]> {
  try {
    return await deps.skills.forAgent(actor);
  } catch (error) {
    deps.logger.warn({ err: error }, "Skills failed to load, answering without them");
    return [];
  }
}

/**
 * Checks a finished reply against the usage policy. The user already saw it
 * stream, so a blocked reply is replaced rather than kept; a failed check
 * keeps the reply, since the input was already checked.
 */
async function allowedOutput(
  deps: ReplyDependencies,
  context: AiCallContext,
  text: string,
): Promise<boolean> {
  if (!text.trim()) return true;
  try {
    const result = await deps.ai.moderator.check(context, text);
    return result.allowed;
  } catch (error) {
    deps.logger.warn({ err: error }, "Reply moderation failed, keeping the reply");
    return true;
  }
}

/**
 * Streams the reply to a new message: optional document search first (step 8),
 * then the agent, which may use tools and may pause for approval.
 */
export async function streamReply({
  deps,
  actor,
  prepared,
  res,
  signal,
}: {
  deps: ReplyDependencies;
  actor: Actor;
  prepared: PreparedReply;
  res: Response;
  signal: AbortSignal;
}): Promise<void> {
  const stream = openEventStream(res);
  stream.send({
    type: "start",
    thread: prepared.thread,
    userMessage: prepared.userMessage,
    assistantMessageId: prepared.assistantMessageId,
  });

  const sources: Source[] = [];
  let history = prepared.history;
  const { knowledge } = prepared;
  try {
    if (knowledge.hasDocuments && knowledge.mode !== "off") {
      stream.send({ type: "status", stage: "searching" });
      try {
        const result = await deps.rag.prepare(
          prepared.context,
          {
            history: knowledge.turns,
            message: prepared.userMessage.content,
            mode: knowledge.mode,
            hasDocuments: true,
          },
          signal,
        );
        if (result.route === "documents") {
          sources.push(...result.sources);
          history = withSources(history, sourcesPrompt(result.sources));
          stream.send({ type: "sources", sources: markCited(sources, "") });
        }
      } catch (error) {
        if (error instanceof AiError || signal.aborted) throw error;
        // Search trouble shouldn't cost the user their answer.
        deps.logger.warn({ err: error }, "Document search failed, answering without it");
      }
      stream.send({ type: "status", stage: "writing" });
    }
  } catch (error) {
    // A spend cap hit during search ends the reply like any other failure.
    await drive({
      deps,
      actor,
      stream,
      signal,
      context: prepared.context,
      threadId: prepared.thread.id,
      messageId: prepared.assistantMessageId,
      modelId: prepared.model.id,
      canUseTools: false,
      skills: [],
      sources,
      initialText: "",
      initialToolCalls: [],
      initialActivity: [],
      start: () => Promise.reject(error),
    });
    stream.end();
    return;
  }

  const canUseTools = prepared.model.capabilities.includes("tools");
  const skills = canUseTools ? await loadSkills(deps, actor) : [];
  if (skills.length) history = withSources(history, skillsPrompt(skills));
  const finalHistory = history;
  // The other modes plan and delegate with tool calls, so they need a model that can make them.
  const mode: AgentMode = canUseTools ? prepared.mode : "auto";
  await drive({
    deps,
    actor,
    stream,
    signal,
    context: prepared.context,
    threadId: prepared.thread.id,
    messageId: prepared.assistantMessageId,
    modelId: prepared.model.id,
    canUseTools,
    skills,
    sources,
    initialText: "",
    initialToolCalls: [],
    initialActivity: [],
    start: (options) => runOrchestrator(options, mode, finalHistory),
    ...(prepared.isNewThread
      ? {
          after: async () => {
            const title = await deps.service.generateTitle(prepared, prepared.userMessage.content);
            stream.send({ type: "title", threadId: prepared.thread.id, title });
          },
        }
      : {}),
  });
  stream.end();
}

/** Continues a paused reply once the user approves or declines the pending tool call. */
export async function streamDecision({
  deps,
  actor,
  claimed,
  callId,
  approved,
  res,
  signal,
}: {
  deps: ReplyDependencies;
  actor: Actor;
  claimed: { run: AgentRunRow; message: ChatMessage };
  callId: string;
  approved: boolean;
  res: Response;
  signal: AbortSignal;
}): Promise<void> {
  const { run, message } = claimed;
  const checkpoint = toOrchestratorCheckpoint(run.checkpoint);
  const stream = openEventStream(res);
  stream.send({ type: "resume", message });
  const model = deps.ai.registry.list({ kind: "chat" }).find((item) => item.id === run.modelId);
  await drive({
    deps,
    actor,
    stream,
    signal,
    context: {
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      feature: "chat",
      ...(actor.requestId ? { requestId: actor.requestId } : {}),
    },
    threadId: run.threadId,
    messageId: run.messageId,
    modelId: run.modelId,
    canUseTools: model?.capabilities.includes("tools") ?? true,
    skills: await loadSkills(deps, actor),
    sources: run.sources.map(({ cited: _cited, ...source }) => source),
    initialText: checkpoint.text,
    initialToolCalls: checkpoint.toolCalls,
    initialActivity: checkpoint.activity,
    runId: run.id,
    start: (options) => resumeOrchestrator(options, checkpoint, { callId, approved }),
  });
  stream.end();
}
