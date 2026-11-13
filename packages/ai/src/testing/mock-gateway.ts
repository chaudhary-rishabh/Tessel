import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local stand-in for the AI Gateway's OpenAI-compatible API (and Anthropic's
 * Messages API, for the fallback route), for tests and offline development. Replies are scripted with `enqueue`; otherwise it
 * answers with an echo of the last user message.
 *
 * Moderation: text containing MOCK_BLOCK is flagged as "weapons" and text
 * containing MOCK_SELF_HARM as "self_harm". MOCK_SLOW streams a long reply
 * slowly (for stop tests) and MOCK_FAIL returns a 400. Title requests get the
 * first words of the conversation. The RAG router searches unless the message
 * contains MOCK_DIRECT, the reranker drops passages containing
 * MOCK_IRRELEVANT, and replies with sources cite [1].
 *
 * Agent modes: plans have two steps (MOCK_ONE_STEP: one); progress reviews
 * continue unless the request has MOCK_FINISH_EARLY or MOCK_REVISE; draft
 * reviews ask for a fix when it has MOCK_CRITIQUE; the supervisor hands one
 * task to its first worker (MOCK_TWO_WORKERS: one to each of the first two),
 * then finishes. Final answers say what they were written from.
 * MOCK_SKILL <name> loads that skill; the reply then quotes its first line.
 * Graph: "MOCK_REL: A (Type) | RELATION | B (Type)" in a document becomes a
 * relationship, and quoted names in a question are routed to the graph.
 * Memory: "MOCK_REMEMBER: <fact>" in a user turn is saved, MOCK_FORGET clears
 * memories, and chat summaries say how many turns they cover.
 */
export interface MockReply {
  text?: string;
  toolCall?: { name: string; args: unknown };
  /** Several tool calls in one reply. */
  toolCalls?: { name: string; args: unknown }[];
  /** Respond with this HTTP status and an error body. */
  status?: number;
  /** The error body's message, with `status` (defaults to "Mock <status>"). */
  errorMessage?: string;
  /** Drop the connection without responding. */
  networkError?: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    cachedTokens?: number;
    reasoningTokens?: number;
  };
  /** Pause between streamed chunks, for stop tests. */
  chunkDelayMs?: number;
}

export interface RecordedRequest {
  path: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

export interface MockGateway {
  /** Base URL including /v1, as the gateway URL setting expects. */
  url: string;
  requests: RecordedRequest[];
  /** Scripted replies, used in order before falling back to the default. */
  enqueue(...replies: MockReply[]): void;
  reset(): void;
  close(): Promise<void>;
}

interface ChatMessage {
  role: string;
  content: unknown;
}

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
      : "";

const tokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

function defaultReply(body: Record<string, unknown>): MockReply {
  const messages = (body.messages as ChatMessage[] | undefined) ?? [];
  const tools = (body.tools as { function?: { name?: string } }[] | undefined) ?? [];
  const lastUser = textOf(messages.findLast((message) => message.role === "user")?.content);

  if (tools.some((tool) => tool.function?.name === "moderation_result")) {
    const categories = [
      ...(lastUser.includes("MOCK_BLOCK") ? ["weapons"] : []),
      ...(lastUser.includes("MOCK_SELF_HARM") ? ["self_harm"] : []),
    ];
    return { toolCall: { name: "moderation_result", args: { categories } } };
  }
  if (tools.some((tool) => tool.function?.name === "route_message")) {
    const message = /<message>\n([\s\S]*?)\n<\/message>/.exec(lastUser)?.[1] ?? lastUser;
    const direct = message.includes("MOCK_DIRECT");
    // Quoted names are the entities a relationship question is about.
    const entities = [...message.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
    return {
      toolCall: {
        name: "route_message",
        args: {
          use_documents: !direct,
          queries: direct ? [] : [message],
          graph_entities: entities,
        },
      },
    };
  }
  if (tools.some((tool) => tool.function?.name === "rank_passages")) {
    const passages = [
      ...lastUser.matchAll(/<passage id="(\d+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g),
    ].map(([, id, text]) => ({
      id: Number(id),
      relevance: text!.includes("MOCK_IRRELEVANT") ? 0 : 3,
    }));
    return { toolCall: { name: "rank_passages", args: { passages } } };
  }
  const forced = (body.tool_choice as { function?: { name?: string } } | undefined)?.function?.name;
  const requestText = lastUser;
  if (forced === "extract_graph") {
    // "MOCK_REL: Source (Type) | RELATION | Target (Type)" lines become graph facts.
    const text = /<text>\n([\s\S]*?)\n<\/text>/.exec(requestText)?.[1] ?? "";
    const entities = new Map<string, { name: string; type: string; description: string }>();
    const relations = [
      ...text.matchAll(/MOCK_REL: ([^|\n]+?) \((\w+)\) \| (\w+) \| ([^|\n]+?) \((\w+)\)/g),
    ].map(([, source, sourceType, type, target, targetType]) => {
      entities.set(source!, { name: source!, type: sourceType!, description: "" });
      entities.set(target!, { name: target!, type: targetType!, description: "" });
      return {
        source,
        target,
        type,
        description: `${source} ${type!.toLowerCase().replace(/_/g, " ")} ${target}.`,
      };
    });
    return {
      toolCall: { name: "extract_graph", args: { entities: [...entities.values()], relations } },
    };
  }
  if (forced === "update_memories") {
    const turns = /<turns>\n([\s\S]*?)\n<\/turns>/.exec(requestText)?.[1] ?? "";
    const add = [...turns.matchAll(/^user: .*?MOCK_REMEMBER: ([^\n]+)$/gm)].map((match) =>
      match[1]!.trim(),
    );
    const ids = [...requestText.matchAll(/<memory id="([^"]+)">/g)].map((match) => match[1]!);
    const forget = /^user: .*MOCK_FORGET/m.test(turns);
    return {
      toolCall: { name: "update_memories", args: { add, update: [], remove: forget ? ids : [] } },
    };
  }
  if (forced === "make_plan") {
    const steps = [
      { title: "Gather the facts", instruction: "Find what's needed" },
      { title: "Work out the answer", instruction: "Use the facts" },
    ];
    return {
      toolCall: {
        name: "make_plan",
        args: { steps: requestText.includes("MOCK_ONE_STEP") ? steps.slice(0, 1) : steps },
      },
    };
  }
  if (forced === "review_progress") {
    const action = requestText.includes("MOCK_FINISH_EARLY")
      ? "finish"
      : requestText.includes("MOCK_REVISE")
        ? "revise"
        : "continue";
    return {
      toolCall: {
        name: "review_progress",
        args: {
          action,
          steps:
            action === "revise" ? [{ title: "Double-check", instruction: "Check the result" }] : [],
        },
      },
    };
  }
  if (forced === "review_draft") {
    const critique = requestText.includes("MOCK_CRITIQUE");
    return {
      toolCall: {
        name: "review_draft",
        args: critique
          ? { verdict: "revise", issues: ["Add a one-line summary"] }
          : { verdict: "good", issues: [] },
      },
    };
  }
  if (forced === "delegate") {
    const tool = tools.find((item) => item.function?.name === "delegate") as
      { function: { parameters?: { properties?: { next?: { enum?: string[] } } } } } | undefined;
    const workers = (tool?.function.parameters?.properties?.next?.enum ?? []).filter(
      (name) => name !== "finish",
    );
    const reports = (requestText.match(/<report /g) ?? []).length;
    const wanted = requestText.includes("MOCK_TWO_WORKERS") ? 2 : 1;
    const next = reports < Math.min(wanted, workers.length) ? workers[reports]! : "finish";
    return {
      toolCall: {
        name: "delegate",
        args: { next, task: next === "finish" ? "" : `Task for ${next}` },
      },
    };
  }

  // Agent tests: after a tool result, report it; MOCK_TOOLS <json> in the user's
  // message asks for those tool calls (only while the tools are on offer).
  const last = messages.at(-1);
  if (last?.role === "tool") {
    const skill = /<skill name="[^"]+" title="([^"]+)">\n([^\n]*)/.exec(textOf(last.content));
    if (skill) return { text: `Following the ${skill[1]} skill: ${skill[2]}` };
    const result = textOf(last.content)
      .replace(/<\/?tool_result[^>]*>/g, "")
      .trim();
    return { text: `Tool result: ${result}` };
  }
  const skillRequest = /MOCK_SKILL ([a-z0-9-]+)/.exec(lastUser)?.[1];
  if (skillRequest && tools.some((tool) => tool.function?.name === "load_skill")) {
    return { toolCall: { name: "load_skill", args: { name: skillRequest } } };
  }
  const requested = /MOCK_TOOLS (\[.*\])/s.exec(lastUser)?.[1];
  if (requested && tools.length > 0) {
    return { toolCalls: JSON.parse(requested) as { name: string; args: unknown }[] };
  }
  const system = textOf(messages.find((message) => message.role === "system")?.content);
  if (system.startsWith("Summarize this conversation")) {
    const turns = (lastUser.match(/^(user|assistant): /gm) ?? []).length;
    return { text: `Summary of ${turns} earlier turns.` };
  }
  if (system.startsWith("Write a short title")) {
    const words = lastUser.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
    return { text: words || "New chat" };
  }
  // Final answers in agent modes say what they were written from.
  if (tools.length === 0) {
    const count = (tag: string) => (system.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
    if (system.includes("<draft>")) return { text: "Revised answer with a one-line summary." };
    if (system.includes("<results>")) return { text: `Answer from ${count("step")} results.` };
    if (system.includes("<reports>")) return { text: `Answer from ${count("report")} reports.` };
  }
  if (lastUser.includes("MOCK_SLOW")) {
    return { text: Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "), chunkDelayMs: 50 };
  }
  if (lastUser.includes("MOCK_FAIL")) return { status: 400 };
  // Images arrive as content parts; say how many so tests can check they were sent.
  const lastContent = messages.findLast((message) => message.role === "user")?.content;
  const images = Array.isArray(lastContent)
    ? lastContent.filter((part) => part?.type === "image_url").length
    : 0;
  // With sources in the system prompt, cite the first one like a real model would.
  const cites = /<source id="1"/.test(system) ? " [1]" : "";
  return {
    text: `Echo: ${lastUser}${images ? ` [${images} image${images > 1 ? "s" : ""}]` : ""}${cites}`,
  };
}

function usageFor(body: Record<string, unknown>, reply: MockReply, output: string) {
  const messages = (body.messages as ChatMessage[] | undefined) ?? [];
  const promptTokens =
    reply.usage?.promptTokens ?? tokens(messages.map((m) => textOf(m.content)).join(""));
  const completionTokens = reply.usage?.completionTokens ?? tokens(output);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_tokens_details: { cached_tokens: reply.usage?.cachedTokens ?? 0 },
    completion_tokens_details: { reasoning_tokens: reply.usage?.reasoningTokens ?? 0 },
  };
}

function vectorFor(text: string, dimensions: number): number[] {
  const digest = createHash("sha256").update(text).digest();
  return Array.from(
    { length: dimensions },
    (_, index) => (digest[index % digest.length]! - 128) / 128,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function lastAnthropicUserText(body: Record<string, unknown>): string {
  const messages = (body.messages ?? []) as { role: string; content: unknown }[];
  const last = messages.toReversed().find((message) => message.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return (last.content as { type: string; text?: string }[])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function startMockGateway({ port = 0 }: { port?: number } = {}): Promise<MockGateway> {
  const queue: MockReply[] = [];
  const requests: RecordedRequest[] = [];
  let counter = 0;

  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      const body = req.method === "POST" ? await readJson(req) : {};
      requests.push({ path, headers: req.headers, body });

      if (req.method === "GET" && path.endsWith("/health"))
        return sendJson(res, 200, { status: "ok" });

      if (path.endsWith("/embeddings")) {
        const reply = queue.shift();
        if (reply?.networkError) return req.socket.destroy();
        if (reply?.status)
          return sendJson(res, reply.status, { error: { message: "Mock failure" } });
        const input = Array.isArray(body.input)
          ? (body.input as string[])
          : [String(body.input ?? "")];
        const dimensions = typeof body.dimensions === "number" ? body.dimensions : 8;
        const promptTokens = input.reduce((total, text) => total + tokens(text), 0);
        return sendJson(res, 200, {
          object: "list",
          model: body.model,
          data: input.map((text, index) => ({
            object: "embedding",
            index,
            embedding: vectorFor(text, dimensions),
          })),
          usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
          providerMetadata: { gateway: { cost: ((promptTokens * 0.02) / 1e6).toFixed(10) } },
        });
      }

      // Anthropic's Messages API, for the emergency fallback route.
      if (path.endsWith("/messages")) {
        const reply = queue.shift() ?? { text: `Echo: ${lastAnthropicUserText(body)}` };
        if (reply.networkError) return req.socket.destroy();
        if (reply.status) {
          return sendJson(res, reply.status, {
            type: "error",
            error: { type: "api_error", message: `Mock ${reply.status}` },
          });
        }
        counter += 1;
        const text = reply.text ?? "";
        const inputTokens = reply.usage?.promptTokens ?? tokens(JSON.stringify(body.messages));
        const outputTokens = reply.usage?.completionTokens ?? tokens(text);
        const message = {
          id: `msg_mock_${counter}`,
          type: "message",
          role: "assistant",
          model: body.model,
          stop_sequence: null,
        };
        if (!body.stream) {
          return sendJson(res, 200, {
            ...message,
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          });
        }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        const send = (event: string, data: unknown) =>
          res.write(
            `event: ${event}\ndata: ${JSON.stringify({ type: event, ...(data as object) })}\n\n`,
          );
        send("message_start", {
          message: {
            ...message,
            content: [],
            stop_reason: null,
            usage: { input_tokens: inputTokens, output_tokens: 0 },
          },
        });
        send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        for (const piece of text.match(/\S+\s*/g) ?? []) {
          if (res.destroyed) return;
          send("content_block_delta", { index: 0, delta: { type: "text_delta", text: piece } });
        }
        send("content_block_stop", { index: 0 });
        send("message_delta", {
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: outputTokens },
        });
        send("message_stop", {});
        return res.end();
      }

      if (!path.endsWith("/chat/completions"))
        return sendJson(res, 404, { error: { message: "Not found" } });

      const reply = queue.shift() ?? defaultReply(body);
      if (reply.networkError) return req.socket.destroy();
      if (reply.status) {
        return sendJson(res, reply.status, {
          error: { message: reply.errorMessage ?? `Mock ${reply.status}`, type: "mock_error" },
        });
      }

      counter += 1;
      const id = `chatcmpl-mock-${counter}`;
      const created = Math.floor(Date.now() / 1000);
      const model = body.model;
      const text = reply.text ?? "";
      const requested = reply.toolCalls ?? (reply.toolCall ? [reply.toolCall] : []);
      const toolCalls = requested.length
        ? requested.map((call, index) => ({
            id: `call_mock_${counter}_${index}`,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          }))
        : undefined;
      const finishReason = toolCalls ? "tool_calls" : "stop";
      const usage = usageFor(
        body,
        reply,
        text || JSON.stringify(requested.map((call) => call.args)),
      );

      if (!body.stream) {
        return sendJson(res, 200, {
          id,
          object: "chat.completion",
          created,
          model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: toolCalls ? null : text,
                ...(toolCalls ? { tool_calls: toolCalls } : {}),
              },
              finish_reason: finishReason,
            },
          ],
          usage,
        });
      }

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const send = (chunk: unknown) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      const base = { id, object: "chat.completion.chunk", created, model };
      send({
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      });
      const pieces = text.match(/\S+\s*/g) ?? [];
      for (const piece of pieces) {
        if (res.destroyed) return;
        if (reply.chunkDelayMs) await sleep(reply.chunkDelayMs);
        send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
      }
      if (toolCalls) {
        send({
          ...base,
          choices: [
            {
              index: 0,
              delta: { tool_calls: toolCalls.map((call, index) => ({ index, ...call })) },
              finish_reason: null,
            },
          ],
        });
      }
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] });
      const streamOptions = body.stream_options as { include_usage?: boolean } | undefined;
      if (streamOptions?.include_usage) send({ ...base, choices: [], usage });
      res.end("data: [DONE]\n\n");
    })().catch((error: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: { message: String(error) } });
      else res.destroy();
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actualPort } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${actualPort}/v1`,
    requests,
    enqueue: (...replies) => queue.push(...replies),
    reset: () => {
      queue.length = 0;
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
