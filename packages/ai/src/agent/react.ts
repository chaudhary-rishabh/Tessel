import {
  AIMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  ToolMessage,
  type AIMessageChunk,
  type BaseMessage,
  type StoredMessage,
  type ToolCall,
} from "@langchain/core/messages";
import type { Logger } from "@tessel/logger";
import type { TesselChatModel } from "../chat-model";
import { AiError } from "../errors";
import type { AiCallContext } from "../usage";
import { needsApproval, ToolError, type ToolDefinition, type ToolRegistry } from "./tools";

export type ToolCallStatus =
  "running" | "waiting" | "completed" | "failed" | "rejected" | "cancelled";

/** A tool call as the interface shows it and the database keeps it. */
export interface ToolCallRecord {
  id: string;
  name: string;
  title: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  requiresApproval: boolean;
  /** For approvals: what will happen, in words. */
  description?: string;
  summary?: string;
  error?: string;
}

export type AgentEvent = { type: "token"; text: string } | { type: "tool"; call: ToolCallRecord };

/** Everything needed to continue a run later, e.g. after the user approves a tool call. */
export interface AgentCheckpoint {
  messages: StoredMessage[];
  toolCalls: ToolCallRecord[];
  text: string;
  steps: number;
  /** The tool call waiting for approval. */
  pendingCallId: string | null;
}

export interface AgentResult extends AgentCheckpoint {
  status: "complete" | "waiting";
}

export interface AgentOptions {
  model: TesselChatModel;
  tools: ToolRegistry;
  context: AiCallContext;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
  logger: Logger;
  /** Called with each tool's artifact, e.g. to collect citation sources. */
  onArtifact?: (tool: string, artifact: unknown) => void;
  maxSteps?: number;
  toolTimeoutMs?: number;
  /**
   * The message to show for an error a tool threw, when it's safe to show,
   * e.g. a permission error. Others are reported as an unexpected failure,
   * so internals like hostnames never reach the user or the model.
   */
  describeError?: (error: unknown) => string | undefined;
}

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const MAX_TOOL_RESULT_CHARACTERS = 12_000;
const DECLINED =
  "The user declined this action. Don't try it again unless they ask; say what you would have done instead.";

const wrapResult = (name: string, content: string) =>
  `<tool_result name="${name}">\n${content.length > MAX_TOOL_RESULT_CHARACTERS ? `${content.slice(0, MAX_TOOL_RESULT_CHARACTERS)}\n[truncated]` : content}\n</tool_result>`;

/**
 * A ReAct agent: the model reasons, calls tools, reads their results, and
 * repeats until it answers. Read-only tools run straight away. A tool that
 * changes data pauses the run: the result is "waiting", with a checkpoint
 * the caller saves and later passes to `resumeAgent` with the user's decision.
 *
 * Tool arguments are validated against each tool's schema, results are
 * marked as data, and tools act only as the signed-in user from `context`.
 */
export async function runAgent(
  options: AgentOptions,
  messages: BaseMessage[],
): Promise<AgentResult> {
  return loop(options, { history: messages, toolCalls: [], text: "", steps: 0 });
}

/** Continues a waiting run with the user's decision on the pending tool call. */
export async function resumeAgent(
  options: AgentOptions,
  checkpoint: AgentCheckpoint,
  decision: { callId: string; approved: boolean },
): Promise<AgentResult> {
  if (checkpoint.pendingCallId !== decision.callId) {
    throw new AiError(409, "approval_not_pending", "This action is no longer waiting for approval");
  }
  const history = mapStoredMessagesToChatMessages(checkpoint.messages);
  const state: RunState = {
    history,
    toolCalls: checkpoint.toolCalls,
    text: checkpoint.text,
    steps: checkpoint.steps,
  };
  const last = history.at(-1 - countTrailingToolMessages(history));
  const calls = last instanceof AIMessage ? (last.tool_calls ?? []) : [];
  const index = calls.findIndex((call) => call.id === decision.callId);
  if (index === -1)
    throw new AiError(409, "approval_not_pending", "This action is no longer waiting for approval");

  const waiting = await runCalls(options, state, calls.slice(index), decision);
  if (waiting) return checkpointOf(state, "waiting", waiting);
  return loop(options, state);
}

interface RunState {
  history: BaseMessage[];
  toolCalls: ToolCallRecord[];
  text: string;
  steps: number;
}

function countTrailingToolMessages(history: BaseMessage[]): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0 && history[i] instanceof ToolMessage; i -= 1) count += 1;
  return count;
}

function checkpointOf(
  state: RunState,
  status: AgentResult["status"],
  pendingCallId: string | null,
): AgentResult {
  return {
    status,
    messages: mapChatMessagesToStoredMessages(state.history),
    toolCalls: state.toolCalls,
    text: state.text,
    steps: state.steps,
    pendingCallId,
  };
}

async function loop(options: AgentOptions, state: RunState): Promise<AgentResult> {
  const { model, tools, emit, signal } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const definitions = tools.definitions();

  while (state.steps < maxSteps) {
    state.steps += 1;
    // The last step answers without tools, so a run always ends with text.
    const lastStep = state.steps >= maxSteps;
    const runnable = lastStep || definitions.length === 0 ? model : model.bindTools(definitions);

    let reply: AIMessageChunk | undefined;
    let separated = state.text.length === 0;
    for await (const chunk of await runnable.stream(state.history, { signal })) {
      reply = reply ? reply.concat(chunk) : chunk;
      if (chunk.text) {
        if (!separated) {
          emit({ type: "token", text: "\n\n" });
          state.text += "\n\n";
          separated = true;
        }
        state.text += chunk.text;
        emit({ type: "token", text: chunk.text });
      }
    }

    const calls = lastStep ? [] : (reply?.tool_calls ?? []);
    state.history.push(
      new AIMessage({
        content: reply?.content ?? "",
        tool_calls: calls,
        ...(reply?.id ? { id: reply.id } : {}),
      }),
    );
    if (calls.length === 0) return checkpointOf(state, "complete", null);

    const waiting = await runCalls(options, state, calls);
    if (waiting) return checkpointOf(state, "waiting", waiting);
  }
  return checkpointOf(state, "complete", null);
}

function upsert(state: RunState, record: ToolCallRecord, emit: AgentOptions["emit"]) {
  const index = state.toolCalls.findIndex((call) => call.id === record.id);
  if (index === -1) state.toolCalls.push(record);
  else state.toolCalls[index] = record;
  emit({ type: "tool", call: record });
}

/**
 * Runs tool calls in order. Returns the ID of the first call that needs
 * approval (leaving it and later calls for resume), or null when all ran.
 */
async function runCalls(
  options: AgentOptions,
  state: RunState,
  calls: ToolCall[],
  decision?: { callId: string; approved: boolean },
): Promise<string | null> {
  const { tools, emit } = options;
  for (const call of calls) {
    const id = call.id ?? `call_${state.toolCalls.length + 1}`;
    const tool = tools.get(call.name);
    const base = {
      id,
      name: call.name,
      title: tool?.title ?? call.name,
      args: call.args,
      requiresApproval: tool ? needsApproval(tool) : false,
    };
    const respond = (content: string) =>
      state.history.push(
        new ToolMessage({
          tool_call_id: id,
          name: call.name,
          content: wrapResult(call.name, content),
        }),
      );

    if (!tool) {
      upsert(state, { ...base, status: "failed", error: "Unknown tool" }, emit);
      respond(`Error: there is no tool called "${call.name}".`);
      continue;
    }
    const parsed = tool.schema.safeParse(call.args);
    if (!parsed.success) {
      upsert(state, { ...base, status: "failed", error: "Invalid arguments" }, emit);
      respond(
        `Error: invalid arguments. ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
      continue;
    }
    let description: string | undefined;
    try {
      description = await tool.describeCall?.(parsed.data);
    } catch {
      // A description is a courtesy; the call itself reports real failures.
    }
    const record = { ...base, ...(description ? { description } : {}) };

    if (needsApproval(tool) && decision?.callId !== id) {
      upsert(state, { ...record, status: "waiting" }, emit);
      return id;
    }
    if (decision?.callId === id && !decision.approved) {
      upsert(state, { ...record, status: "rejected" }, emit);
      respond(DECLINED);
      continue;
    }
    await execute(options, state, tool, parsed.data, record, respond);
  }
  return null;
}

async function execute(
  options: AgentOptions,
  state: RunState,
  tool: ToolDefinition,
  args: unknown,
  record: Omit<ToolCallRecord, "status">,
  respond: (content: string) => void,
) {
  const { emit, signal, context, logger } = options;
  upsert(state, { ...record, status: "running" }, emit);
  const timeout = AbortSignal.timeout(options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS);
  try {
    const combined = AbortSignal.any([signal, timeout]);
    // A tool that ignores its signal still can't hold the run past the timeout.
    const output = await Promise.race([
      tool.run(args, { context, signal: combined }),
      new Promise<never>((_, reject) => {
        if (combined.aborted) reject(combined.reason);
        combined.addEventListener("abort", () => reject(combined.reason), { once: true });
      }),
    ]);
    if (output.artifact !== undefined) options.onArtifact?.(tool.name, output.artifact);
    upsert(state, { ...record, status: "completed", summary: output.summary }, emit);
    respond(output.content);
  } catch (error) {
    if (signal.aborted) throw error;
    // Spend caps and similar stop the whole reply, not just this tool.
    if (error instanceof AiError && error.status === 429) throw error;
    const expected =
      error instanceof ToolError || error instanceof AiError
        ? error.message
        : options.describeError?.(error);
    const message = timeout.aborted
      ? "The tool took too long"
      : (expected ?? "The tool failed unexpectedly");
    if (expected === undefined) logger.warn({ err: error, tool: tool.name }, "Tool failed");
    upsert(state, { ...record, status: "failed", error: message }, emit);
    respond(`Error: ${message}`);
  }
}
