"use client";

import { toApiClientError, type ApiClientError } from "@tessel/api-client";
import { queryKeys, updateThreadLists, upsertThreadInList, useApi } from "@tessel/api-client/react";
import type {
  AgentModeName,
  Attachment,
  ChatEvent,
  ChatMessage,
  KnowledgeMode,
  ThreadResponse,
} from "@tessel/contracts";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { replyControllers, useChatStore } from "@/lib/chat-store";
import { useChatPreferences } from "@/lib/chat-preferences";
import { useDocumentScope } from "@/lib/document-scope-store";

export interface SendInput {
  threadId?: string;
  content: string;
  model?: string;
  attachments: Attachment[];
  knowledge?: KnowledgeMode;
  mode?: AgentModeName;
  /** Rewrite the chat from this user message (edit, or the same text to regenerate). */
  editMessageId?: string;
}

export type SendResult = { ok: true } | { ok: false; error: ApiClientError | null };

function setThreadMessages(
  queryClient: QueryClient,
  workspaceId: string,
  threadId: string,
  update: (messages: ChatMessage[]) => ChatMessage[],
) {
  queryClient.setQueryData<ThreadResponse>(queryKeys.thread(workspaceId, threadId), (current) =>
    current ? { ...current, messages: update(current.messages) } : current,
  );
}

const putMessage = (message: ChatMessage) => (messages: ChatMessage[]) => {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) return [...messages, message];
  return messages.map((item, position) => (position === index ? message : item));
};

/**
 * The server cancels a pending action when the user sends a new message
 * instead of deciding; mirror that in the cached thread.
 */
const closeWaiting = (messages: ChatMessage[]) =>
  messages.map((message) =>
    message.status === "waiting"
      ? {
          ...message,
          status: "complete" as const,
          toolCalls: message.toolCalls.map((call) =>
            call.status === "waiting" ? { ...call, status: "cancelled" as const } : call,
          ),
        }
      : message,
  );

/**
 * Streams replies into the live reply store and the thread's cached data:
 * `send` posts a new message, `decide` approves or declines the tool call a
 * reply is waiting on and streams the rest of it. Both return once the reply
 * has finished, paused, stopped, or been refused; a refused message comes back
 * as an error so the composer can put the text back.
 */
export function useReplyStream(workspaceId: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();
  const router = useRouter();

  const handle = useCallback(
    (workspaceId: string, liveKey: () => string, event: ChatEvent) => {
      const store = useChatStore.getState();
      const key = liveKey();
      switch (event.type) {
        case "status":
          store.update(key, { stage: event.stage });
          break;
        case "sources":
          store.update(key, { sources: event.sources });
          break;
        case "token":
          store.append(key, event.text);
          break;
        case "tool":
          store.tool(key, event.call);
          break;
        case "activity":
          store.update(key, { activity: event.items, stage: null });
          break;
        case "done":
          setThreadMessages(queryClient, workspaceId, key, putMessage(event.message));
          store.finish(key);
          break;
        case "error":
          if (event.assistantMessage) {
            setThreadMessages(queryClient, workspaceId, key, putMessage(event.assistantMessage));
          }
          store.finish(key);
          break;
        case "title": {
          const rename = <T extends { id: string; title: string | null }>(thread: T): T =>
            thread.id === event.threadId ? { ...thread, title: event.title } : thread;
          updateThreadLists(queryClient, workspaceId, (threads) => threads.map(rename));
          queryClient.setQueryData<ThreadResponse>(
            queryKeys.thread(workspaceId, event.threadId),
            (current) => (current ? { ...current, thread: rename(current.thread) } : current),
          );
          break;
        }
        default:
          break;
      }
    },
    [queryClient],
  );

  /** What the reply showed when it was stopped; the server saves the same. */
  const stoppedMessage = (key: string, id: string, modelId: string | null): ChatMessage => {
    const live = useChatStore.getState().replies[key];
    return {
      id,
      role: "assistant",
      content: live?.text ?? "",
      status: "stopped",
      modelId,
      errorCode: null,
      createdAt: new Date().toISOString(),
      attachments: [],
      sources: live?.sources ?? [],
      toolCalls: (live?.toolCalls ?? []).map((call) =>
        call.status === "running" ? { ...call, status: "cancelled" as const } : call,
      ),
      activity: (live?.activity ?? []).map((item) =>
        item.status === "running" || item.status === "pending"
          ? { ...item, status: "skipped" as const }
          : item,
      ),
      agentMode: live?.agentMode ?? null,
      voiceSessionId: null,
    };
  };

  const send = useCallback(
    async ({
      threadId,
      content,
      model,
      attachments,
      knowledge,
      mode,
      editMessageId,
    }: SendInput): Promise<SendResult> => {
      if (!workspaceId) return { ok: false, error: null };
      const temporaryKey = threadId ?? `new-${crypto.randomUUID()}`;
      // An edit drops the message and everything after it straight away; the
      // live reply shows the new text until the server confirms it.
      const before =
        threadId && editMessageId
          ? queryClient.getQueryData<ThreadResponse>(queryKeys.thread(workspaceId, threadId))
          : undefined;
      if (threadId && editMessageId) {
        setThreadMessages(queryClient, workspaceId, threadId, (messages) => {
          const index = messages.findIndex((message) => message.id === editMessageId);
          return index === -1 ? messages : messages.slice(0, index);
        });
      }
      let liveKey = temporaryKey;
      let started = false;
      let assistantMessageId = "";

      useChatStore.getState().begin(temporaryKey, content, attachments, mode);
      const controller = new AbortController();
      replyControllers.set(temporaryKey, controller);

      try {
        await api.chat.send(
          workspaceId,
          {
            content,
            attachmentIds: attachments.map((file) => file.id),
            ...(knowledge ? { knowledge } : {}),
            ...(() => {
              // Documents picked in the composer narrow the search.
              const picked = useDocumentScope
                .getState()
                .for(workspaceId)
                .map((doc) => doc.id);
              return picked.length ? { documentIds: picked } : {};
            })(),
            ...(mode ? { mode } : {}),
            // The server applies it only when the model reasons.
            effort: useChatPreferences.getState().effort,
            ...(threadId ? { threadId } : {}),
            ...(model ? { model } : {}),
            ...(editMessageId ? { editMessageId } : {}),
          },
          {
            signal: controller.signal,
            onEvent: (event) => {
              if (event.type !== "start") return handle(workspaceId, () => liveKey, event);
              started = true;
              liveKey = event.thread.id;
              assistantMessageId = event.assistantMessageId;
              replyControllers.move(temporaryKey, liveKey);
              queryClient.setQueryData<ThreadResponse>(
                queryKeys.thread(workspaceId, liveKey),
                (current) => ({
                  thread: event.thread,
                  messages: [...closeWaiting(current?.messages ?? []), event.userMessage],
                }),
              );
              upsertThreadInList(queryClient, workspaceId, event.thread);
              if (!queryClient.getQueryData(queryKeys.threads(workspaceId))) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.threads(workspaceId) });
              }
              useChatStore
                .getState()
                .started(temporaryKey, liveKey, event.userMessage, event.assistantMessageId);
              if (!threadId) router.push(`/chat/${liveKey}`);
            },
          },
        );
        return { ok: true };
      } catch (error) {
        if (!started) {
          if (before && threadId) {
            queryClient.setQueryData(queryKeys.thread(workspaceId, threadId), before);
          }
          return { ok: false, error: controller.signal.aborted ? null : toApiClientError(error) };
        }
        if (controller.signal.aborted) {
          setThreadMessages(
            queryClient,
            workspaceId,
            liveKey,
            putMessage(stoppedMessage(liveKey, assistantMessageId, model ?? null)),
          );
        } else {
          // The connection dropped mid-reply: load whatever the server saved.
          void queryClient.invalidateQueries({ queryKey: queryKeys.thread(workspaceId, liveKey) });
        }
        return { ok: true };
      } finally {
        useChatStore.getState().finish(liveKey);
        useChatStore.getState().finish(temporaryKey);
        replyControllers.delete(liveKey);
        replyControllers.delete(temporaryKey);
        void queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId, "usage"] });
      }
    },
    [api, handle, queryClient, router, workspaceId],
  );

  const decide = useCallback(
    async (
      threadId: string,
      message: ChatMessage,
      callId: string,
      approved: boolean,
    ): Promise<SendResult> => {
      if (!workspaceId) return { ok: false, error: null };
      // Show the reply as live straight away; the saved copy comes back when it ends.
      setThreadMessages(queryClient, workspaceId, threadId, (messages) =>
        messages.filter((item) => item.id !== message.id),
      );
      useChatStore.getState().resume(threadId, {
        ...message,
        toolCalls: message.toolCalls.map((call) =>
          call.id === callId && approved ? { ...call, status: "running" as const } : call,
        ),
      });
      const controller = new AbortController();
      replyControllers.set(threadId, controller);
      let resumed = false;

      try {
        await api.chat.decide(workspaceId, threadId, callId, approved, {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "resume") {
              resumed = true;
              return;
            }
            handle(workspaceId, () => threadId, event);
          },
        });
        return { ok: true };
      } catch (error) {
        if (resumed && controller.signal.aborted) {
          setThreadMessages(
            queryClient,
            workspaceId,
            threadId,
            putMessage(stoppedMessage(threadId, message.id, message.modelId)),
          );
          return { ok: true };
        }
        // Refused (e.g. already decided elsewhere) or dropped: show what the server has.
        void queryClient.invalidateQueries({ queryKey: queryKeys.thread(workspaceId, threadId) });
        return { ok: false, error: controller.signal.aborted ? null : toApiClientError(error) };
      } finally {
        useChatStore.getState().finish(threadId);
        replyControllers.delete(threadId);
        void queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId, "usage"] });
      }
    },
    [api, handle, queryClient, workspaceId],
  );

  return { send, decide };
}

/** Sends a message and streams the reply. See useReplyStream. */
export function useSendMessage(workspaceId: string | undefined) {
  return useReplyStream(workspaceId).send;
}
