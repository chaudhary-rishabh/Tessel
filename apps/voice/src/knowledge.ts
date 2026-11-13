import { llm } from "@livekit/agents";
import { memoryPrompt } from "@tessel/memory";
import type { VoiceRuntime } from "./runtime";
import type { VoiceSessionContext } from "./store";

/** Memories said to the model, as in chat: the newest win when there are more. */
const MAX_PROMPT_MEMORIES = 60;
const SEARCH_RESULTS = 4;
/** A spoken answer needs the gist; long passages only slow the reply. */
const PASSAGE_CHARACTERS = 1_200;

/**
 * What the agent knows beyond the conversation, as chat does: the user's
 * memories and the chat's older summary in its instructions, plus tools to
 * remember something they ask it to and to look things up in the
 * workspace's documents.
 */
export async function voiceKnowledge(
  runtime: VoiceRuntime,
  session: VoiceSessionContext,
  summary: string | null,
): Promise<{ prompt: string; tools: llm.ToolContextEntry[] }> {
  const subject = { workspaceId: session.workspaceId, userId: session.userId };
  const settings = await runtime.memories.settings(subject).catch((error: unknown) => {
    runtime.logger.warn({ err: error }, "Couldn't read memory settings; going without memories");
    return { memoryEnabled: false, chatSearchEnabled: false };
  });
  const memories = settings.memoryEnabled
    ? (await runtime.memories.list(subject).catch(() => []))
        .slice(0, MAX_PROMPT_MEMORIES)
        .map((row) => row.content)
    : [];

  const tools: llm.ToolContextEntry[] = [];
  if (settings.memoryEnabled) {
    tools.push(
      llm.tool({
        name: "remember",
        description:
          "Save a lasting fact or preference the user asked you to remember, in their words. Only when they ask.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "The fact, as one short sentence" },
          },
          required: ["content"],
          additionalProperties: false,
        },
        execute: async ({ content }: { content: string }) => {
          const text = String(content ?? "")
            .trim()
            .slice(0, 500);
          if (!text) return "Nothing to remember.";
          try {
            await runtime.memories.add(subject, {
              content: text,
              source: "tool",
              sourceThreadId: session.threadId,
            });
            return "Saved. Tell them briefly that you'll remember it.";
          } catch (error) {
            runtime.logger.warn({ err: error }, "Couldn't save a memory from voice");
            return "It couldn't be saved. Say so briefly.";
          }
        },
      }),
    );
  }
  if (runtime.documents) {
    const documents = runtime.documents;
    tools.push(
      llm.tool({
        name: "search_documents",
        description:
          "Search the workspace's uploaded documents. Use it for questions about their organisation, policies, products, or anything in their files. Say you're checking first, then answer from what you find in a sentence or two.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "A standalone search query" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        execute: async ({ query }: { query: string }) => {
          try {
            const hits = await documents.search(
              { ...subject, requestId: session.id },
              String(query ?? "").slice(0, 500),
              SEARCH_RESULTS,
            );
            if (hits.length === 0) return "Nothing in their documents matched.";
            return hits
              .map(
                (hit) =>
                  `From ${hit.filename}${hit.page ? `, page ${hit.page}` : ""}:\n${hit.text.slice(0, PASSAGE_CHARACTERS)}`,
              )
              .join("\n\n");
          } catch (error) {
            runtime.logger.warn({ err: error }, "Document search failed in voice");
            return "The documents couldn't be searched right now. Say so briefly.";
          }
        },
      }),
    );
  }

  return { prompt: memoryPrompt({ memories, summary }), tools };
}
