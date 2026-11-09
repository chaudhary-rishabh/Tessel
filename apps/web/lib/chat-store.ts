import type {
  ActivityItemView,
  AgentModeName,
  Attachment,
  ChatMessage,
  MessageSource,
  ToolCallView,
} from "@tessel/contracts";
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
  /** The message being answered, until the server confirms it. Null when continuing a reply. */
  userMessage: ChatMessage | null;
  assistantMessageId: string | null;
  text: string;
  status: LiveStatus;
  /** Set while the documents are searched, before any text arrives. */
  stage: "searching" | "writing" | null;
  sources: MessageSource[];
  toolCalls: ToolCallView[];
  /** Plan steps, hand-offs, and reviews, in agent modes. */
  activity: ActivityItemView[];
  agentMode: AgentModeName | null;
}

interface ChatStore {
  replies: Record<string, LiveReply>;
  begin: (
    key: string,
    content: string,
    attachments: Attachment[],
    agentMode?: AgentModeName,
  ) => void;
  started: (
    key: string,
    threadId: string,
    userMessage: ChatMessage,
    assistantMessageId: string,
  ) => void;
  append: (threadId: string, text: string) => void;
  update: (
    threadId: string,
    patch: Partial<Pick<LiveReply, "stage" | "sources" | "activity">>,
  ) => void;
  /** Adds a tool call, or replaces the earlier state of the same call. */
  tool: (threadId: string, call: ToolCallView) => void;
  /** Continues a saved reply live, e.g. after the user approves a tool call. */
  resume: (threadId: string, message: ChatMessage) => void;
  finish: (key: string) => void;
}

const controllers = new Map<string, AbortController>();

export const useChatStore = create<ChatStore>()((set) => ({
  replies: {},
  begin: (key, content, attachments, agentMode) =>
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
            toolCalls: [],
            activity: [],
            agentMode: null,
          },
          assistantMessageId: null,
          text: "",
          status: "sending",
          stage: null,
          sources: [],
          toolCalls: [],
          activity: [],
          agentMode: agentMode ?? null,
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
  tool: (threadId, call) =>
    set((state) => {
      const reply = state.replies[threadId];
      if (!reply) return state;
      const exists = reply.toolCalls.some((item) => item.id === call.id);
      const toolCalls = exists
        ? reply.toolCalls.map((item) => (item.id === call.id ? call : item))
        : [...reply.toolCalls, call];
      return { replies: { ...state.replies, [threadId]: { ...reply, toolCalls, stage: null } } };
    }),
  resume: (threadId, message) =>
    set((state) => ({
      replies: {
        ...state.replies,
        [threadId]: {
          key: threadId,
          threadId,
          userMessage: null,
          assistantMessageId: message.id,
          text: message.content,
          status: "streaming",
          stage: null,
          sources: message.sources,
          toolCalls: message.toolCalls,
          activity: message.activity,
          agentMode: message.agentMode,
        },
      },
    })),
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

/**
 * Stops every reply in progress and forgets them, when the person signs out
 * or someone else signs in: nothing streams into the next session.
 */
export function resetChatSession() {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  useChatStore.setState({ replies: {} });
}
