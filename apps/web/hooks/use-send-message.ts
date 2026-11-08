"use client";

import { ApiClientError, toApiClientError } from "@tessel/api-client";
import { queryKeys, upsertThreadInList, useApi } from "@tessel/api-client/react";
import type {
  Attachment,
  ChatMessage,
  KnowledgeMode,
  ThreadListResponse,
  ThreadResponse,
} from "@tessel/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { replyControllers, useChatStore } from "@/lib/chat-store";

export interface SendInput {
  threadId?: string;
  content: string;
  model?: string;
  attachments: Attachment[];
  knowledge?: KnowledgeMode;
}

export type SendResult = { ok: true } | { ok: false; error: ApiClientError | null };

/**
 * Sends a message and streams the reply into the live reply store and the
 * thread's cached data. Returns once the reply has finished, stopped, or
 * been refused; a refused message comes back as an error so the composer
 * can put the text back.
 */
export function useSendMessage(workspaceId: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();
  const router = useRouter();

  return useCallback(
    async ({
      threadId,
      content,
      model,
      attachments,
      knowledge,
    }: SendInput): Promise<SendResult> => {
      if (!workspaceId) return { ok: false, error: null };
      const store = useChatStore.getState();
      const temporaryKey = threadId ?? `new-${crypto.randomUUID()}`;
      let liveKey = temporaryKey;
      let started = false;
      let assistantMessageId = "";
      let text = "";

      const appendMessage = (id: string, message: ChatMessage) =>
        queryClient.setQueryData<ThreadResponse>(queryKeys.thread(workspaceId, id), (current) =>
          current
            ? {
                ...current,
                messages: [...current.messages.filter((m) => m.id !== message.id), message],
              }
            : current,
        );

      store.begin(temporaryKey, content, attachments);
      const controller = new AbortController();
      replyControllers.set(temporaryKey, controller);

      try {
        await api.chat.send(
          workspaceId,
          {
            content,
            attachmentIds: attachments.map((file) => file.id),
            ...(knowledge ? { knowledge } : {}),
            ...(threadId ? { threadId } : {}),
            ...(model ? { model } : {}),
          },
          {
            signal: controller.signal,
            onEvent: (event) => {
              switch (event.type) {
                case "start": {
                  started = true;
                  liveKey = event.thread.id;
                  assistantMessageId = event.assistantMessageId;
                  replyControllers.move(temporaryKey, liveKey);
                  queryClient.setQueryData<ThreadResponse>(
                    queryKeys.thread(workspaceId, liveKey),
                    (current) => ({
                      thread: event.thread,
                      messages: [...(current?.messages ?? []), event.userMessage],
                    }),
                  );
                  upsertThreadInList(queryClient, workspaceId, event.thread);
                  if (!queryClient.getQueryData(queryKeys.threads(workspaceId))) {
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.threads(workspaceId),
                    });
                  }
                  useChatStore
                    .getState()
                    .started(temporaryKey, liveKey, event.userMessage, event.assistantMessageId);
                  if (!threadId) router.push(`/chat/${liveKey}`);
                  break;
                }
                case "status":
                  useChatStore.getState().update(liveKey, { stage: event.stage });
                  break;
                case "sources":
                  useChatStore.getState().update(liveKey, { sources: event.sources });
                  break;
                case "token":
                  text += event.text;
                  useChatStore.getState().append(liveKey, event.text);
                  break;
                case "done":
                  appendMessage(liveKey, event.message);
                  useChatStore.getState().finish(liveKey);
                  break;
                case "error":
                  if (event.assistantMessage) appendMessage(liveKey, event.assistantMessage);
                  useChatStore.getState().finish(liveKey);
                  break;
                case "title": {
                  const rename = <T extends { id: string; title: string | null }>(thread: T): T =>
                    thread.id === event.threadId ? { ...thread, title: event.title } : thread;
                  queryClient.setQueryData<ThreadListResponse>(
                    queryKeys.threads(workspaceId),
                    (current) =>
                      current ? { ...current, threads: current.threads.map(rename) } : current,
                  );
                  queryClient.setQueryData<ThreadResponse>(
                    queryKeys.thread(workspaceId, event.threadId),
                    (current) =>
                      current ? { ...current, thread: rename(current.thread) } : current,
                  );
                  break;
                }
              }
            },
          },
        );
        return { ok: true };
      } catch (error) {
        if (!started) {
          return { ok: false, error: controller.signal.aborted ? null : toApiClientError(error) };
        }
        if (controller.signal.aborted) {
          // The server saves what was streamed as a stopped reply; show the same now.
          appendMessage(liveKey, {
            id: assistantMessageId,
            role: "assistant",
            content: text,
            status: "stopped",
            modelId: model ?? null,
            errorCode: null,
            createdAt: new Date().toISOString(),
            attachments: [],
            sources: useChatStore.getState().replies[liveKey]?.sources ?? [],
          });
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
    [api, queryClient, router, workspaceId],
  );
}

export { ApiClientError };
