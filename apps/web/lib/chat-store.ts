import type { Attachment, ChatMessage, MessageSource } from "@tessel/contracts";
import { create } from "zustand";

export type LiveStatus = "sending" | "streaming";

/**
 * A reply being streamed right now. It lives outside React components so
 * the stream keeps going while the user moves between pages (a new chat
 * opens its own page as soon as the server creates it).
 */
export interface LiveReply {
  /** The thread's ID, or a temporary key until the server creates the thread. */
  key: string;
  threadId: string | null;
  userMessage: ChatMessage;
  assistantMessageId: string | null;
  text: string;
  status: LiveStatus;
  /** Set while the documents are searched, before any text arrives. */
  stage: "searching" | "writing" | null;
  sources: MessageSource[];
}

interface ChatStore {
  replies: Record<string, LiveReply>;
  begin: (key: string, content: string, attachments: Attachment[]) => void;
  started: (
    key: string,
    threadId: string,
    userMessage: ChatMessage,
    assistantMessageId: string,
  ) => void;
  append: (threadId: string, text: string) => void;
  update: (threadId: string, patch: Partial<Pick<LiveReply, "stage" | "sources">>) => void;
  finish: (key: string) => void;
}

const controllers = new Map<string, AbortController>();

export const useChatStore = create<ChatStore>()((set) => ({
  replies: {},
  begin: (key, content, attachments) =>
    set((state) => ({
      replies: {
        ...state.replies,
        [key]: {
          key,
          threadId: null,
          userMessage: {
            id: key,
            role: "user",
            content,
            status: "complete",
            modelId: null,
            errorCode: null,
            createdAt: new Date().toISOString(),
            attachments,
            sources: [],
          },
          assistantMessageId: null,
          text: "",
          status: "sending",
          stage: null,
          sources: [],
        },
      },
    })),
  started: (key, threadId, userMessage, assistantMessageId) =>
    set((state) => {
      const { [key]: reply, ...rest } = state.replies;
      if (!reply) return state;
      return {
        replies: {
          ...rest,
          [threadId]: {
            ...reply,
            key: threadId,
            threadId,
            userMessage,
            assistantMessageId,
            status: "streaming",
          },
        },
      };
    }),
  append: (threadId, text) =>
    set((state) => {
      const reply = state.replies[threadId];
      if (!reply) return state;
      return { replies: { ...state.replies, [threadId]: { ...reply, text: reply.text + text } } };
    }),
  update: (threadId, patch) =>
    set((state) => {
      const reply = state.replies[threadId];
      if (!reply) return state;
      return { replies: { ...state.replies, [threadId]: { ...reply, ...patch } } };
    }),
  finish: (key) =>
    set((state) => {
      const { [key]: _done, ...rest } = state.replies;
      return { replies: rest };
    }),
}));

export const replyControllers = {
  set: (key: string, controller: AbortController) => controllers.set(key, controller),
  move: (from: string, to: string) => {
    const controller = controllers.get(from);
    if (controller) {
      controllers.delete(from);
      controllers.set(to, controller);
    }
  },
  stop: (key: string) => controllers.get(key)?.abort(),
  delete: (key: string) => controllers.delete(key),
};
