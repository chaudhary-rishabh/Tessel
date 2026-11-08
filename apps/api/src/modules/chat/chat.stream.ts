import { SystemMessage, type AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import {
  AiError,
  citedSourceIds,
  sourcesPrompt,
  usageFromMetadata,
  type RagPipeline,
  type Source,
} from "@tessel/ai";
import type { MessageSource } from "@tessel/db";
import type { ChatEvent } from "@tessel/contracts";
import type { Logger } from "@tessel/logger";
import type { Response } from "express";
import type { Actor, ChatService, PreparedReply } from "./chat.service";
import type { Ai } from "@tessel/ai";

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

/**
 * Streams one reply. Tokens go to the client as they arrive; the reply is
 * saved once at the end, as complete, stopped (the client went away), or
 * error. Usage is recorded by the model itself, including for stopped replies.
 */
/** Adds the sources to the system prompt; one system message keeps every provider happy. */
function withSources(history: BaseMessage[], prompt: string): BaseMessage[] {
  const [system, ...rest] = history;
  return [new SystemMessage(`${system?.text ?? ""}\n\n${prompt}`), ...rest];
}

const markCited = (sources: Source[], content: string): MessageSource[] => {
  const cited = new Set(citedSourceIds(content, sources));
  return sources.map((source) => ({ ...source, cited: cited.has(source.id) }));
};

export async function streamReply({
  ai,
  rag,
  service,
  logger,
  actor,
  prepared,
  firstMessage,
  res,
  signal,
}: {
  ai: Ai;
  rag: RagPipeline;
  service: ChatService;
  logger: Logger;
  actor: Actor;
  prepared: PreparedReply;
  firstMessage: string;
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

  let content = "";
  let final: AIMessageChunk | undefined;
  let sources: Source[] = [];
  try {
    let history = prepared.history;
    const { knowledge } = prepared;
    if (knowledge.hasDocuments && knowledge.mode !== "off") {
      stream.send({ type: "status", stage: "searching" });
      try {
        const result = await rag.prepare(
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
          sources = result.sources;
          history = withSources(history, sourcesPrompt(sources));
          stream.send({ type: "sources", sources: markCited(sources, "") });
        }
      } catch (error) {
        if (error instanceof AiError || signal.aborted) throw error;
        // Search trouble shouldn't cost the user their answer.
        logger.warn({ err: error }, "Document search failed, answering without it");
      }
      stream.send({ type: "status", stage: "writing" });
    }

    const model = ai.chatModel(prepared.context, prepared.model.id);
    for await (const chunk of await model.stream(history, { signal })) {
      final = final ? final.concat(chunk) : chunk;
      if (chunk.text) {
        content += chunk.text;
        stream.send({ type: "token", text: chunk.text });
      }
    }
    const usage = usageFromMetadata(final?.usage_metadata);
    const message = await service.finishReply(actor, prepared.assistantMessageId, {
      content,
      status: "complete",
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      sources: markCited(sources, content),
    });
    stream.send({ type: "done", status: "complete", message });

    if (prepared.isNewThread) {
      const title = await service.generateTitle(prepared, firstMessage);
      stream.send({ type: "title", threadId: prepared.thread.id, title });
    }
  } catch (error) {
    if (signal.aborted) {
      // The user pressed stop or closed the tab: keep what they already saw.
      await service
        .finishReply(actor, prepared.assistantMessageId, {
          content,
          status: "stopped",
          sources: markCited(sources, content),
        })
        .catch((saveError: unknown) =>
          logger.error({ err: saveError }, "Failed to save a stopped reply"),
        );
      if (prepared.isNewThread && content) {
        await service.generateTitle(prepared, firstMessage).catch(() => undefined);
      }
    } else {
      const { code, message } = publicError(error);
      if (!(error instanceof AiError)) logger.error({ err: error }, "Chat reply failed");
      const assistantMessage = await service
        .finishReply(actor, prepared.assistantMessageId, {
          content,
          status: "error",
          errorCode: code,
          sources: markCited(sources, content),
        })
        .catch((saveError: unknown) => {
          logger.error({ err: saveError }, "Failed to save a failed reply");
          return undefined;
        });
      stream.send({
        type: "error",
        code,
        message,
        ...(assistantMessage ? { assistantMessage } : {}),
      });
      if (prepared.isNewThread) {
        const title = await service.generateTitle(prepared, firstMessage).catch(() => undefined);
        if (title) stream.send({ type: "title", threadId: prepared.thread.id, title });
      }
    }
  } finally {
    stream.end();
  }
}
