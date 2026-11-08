import { defineTool, type ToolDefinition } from "@tessel/ai";
import { z } from "zod";
import { MAX_MEMORY_CHARACTERS } from "./model";

export interface PastChat {
  threadId: string;
  title: string;
  summary: string;
  updatedAt: string;
}

/**
 * Tools for memory in chat: remember (the user asked Tessel to keep something
 * in mind) and search_past_chats (episodic memory). Both act only on the
 * signed-in user's own memory, which they can review and edit, so neither
 * asks for approval.
 */
export function memoryTools({
  remember,
  searchPastChats,
}: {
  remember?: (content: string) => Promise<void>;
  searchPastChats?: (query: string) => Promise<PastChat[]>;
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  if (remember) {
    tools.push(
      defineTool({
        name: "remember",
        title: "Remember",
        description:
          "Save a short fact about the user to long-term memory, when they ask you to remember something or state a lasting preference. One sentence, third person.",
        schema: z.object({ content: z.string().trim().min(1).max(MAX_MEMORY_CHARACTERS) }),
        risk: "read",
        async run({ content }) {
          await remember(content);
          return { content: `Saved to memory: ${content}`, summary: content };
        },
      }),
    );
  }
  if (searchPastChats) {
    tools.push(
      defineTool({
        name: "search_past_chats",
        title: "Search past chats",
        description:
          "Search the user's earlier chats in this workspace, when they refer to a past conversation or you need context from one.",
        schema: z.object({ query: z.string().trim().min(1).max(500) }),
        risk: "read",
        async run({ query }) {
          const chats = await searchPastChats(query);
          if (chats.length === 0)
            return { content: "No earlier chats matched.", summary: "Nothing found" };
          return {
            content: chats
              .map(
                (chat) =>
                  `<chat id="${chat.threadId}" title="${chat.title.replace(/"/g, "'")}" updated="${chat.updatedAt.slice(0, 10)}">\n${chat.summary}\n</chat>`,
              )
              .join("\n"),
            summary: `Found ${chats.length} chat${chats.length === 1 ? "" : "s"}`,
          };
        },
      }),
    );
  }
  return tools;
}
