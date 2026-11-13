"use client";

import { queryKeys, useApi, useThread } from "@tessel/api-client/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  collectArtifacts,
  parseMessageSegments,
  type Attachment,
  type ChatMessage,
} from "@tessel/contracts";
import { Button, Spinner } from "@tessel/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArtifactPanel } from "@/components/artifacts/artifact-panel";
import { useArtifactPanel } from "@/lib/artifact-store";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { useChatModel } from "@/hooks/use-chat-model";
import { useChatPreferences } from "@/lib/chat-preferences";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { useReplyStream } from "@/hooks/use-send-message";
import { chatErrorMessage } from "@/lib/chat-errors";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { useStartVoice } from "@/hooks/use-voice";
import { replyControllers, useChatStore } from "@/lib/chat-store";

export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const { current } = useCurrentWorkspace();
  const workspaceId = current?.id;
  const thread = useThread(workspaceId, threadId);
  const api = useApi();
  const queryClient = useQueryClient();
  const live = useChatStore((state) => state.replies[threadId]);
  const knowledge = useChatPreferences((state) => state.knowledge);
  const mode = useChatPreferences((state) => state.mode);
  const { send, decide } = useReplyStream(workspaceId);
  const [decisionError, setDecisionError] = useState<string>();
  const { modelId: defaultModel } = useChatModel(thread.data?.thread.modelId);
  // A pick made in this chat applies to its next messages.
  const [picked, setPicked] = useState<string>();
  const modelId = picked ?? defaultModel;
  const startVoice = useStartVoice(workspaceId);
  const messages = useMemo(() => thread.data?.messages ?? [], [thread.data?.messages]);
  const panel = useArtifactPanel();

  // Every artifact's versions, including one being written right now.
  const artifacts = useMemo(
    () =>
      collectArtifacts([
        ...messages,
        ...(live ? [{ id: "live", role: "assistant", content: live.text }] : []),
      ]),
    [messages, live],
  );
  const artifactContext = useMemo(
    () => ({
      threadKey: threadId,
      versionOf: (messageId: string, identifier: string) =>
        (artifacts.get(identifier)?.findIndex((version) => version.messageId === messageId) ?? 0) +
        1,
    }),
    [artifacts, threadId],
  );

  // An artifact being written opens beside the chat, once per reply.
  const opened = useRef(new Set<string>());
  const streaming = live
    ? parseMessageSegments(live.text).findLast((segment) => segment.kind === "artifact")
    : undefined;
  const streamingId = streaming?.kind === "artifact" ? streaming.identifier : undefined;
  useEffect(() => {
    if (!live || !streamingId) return;
    const key = `${live.key}:${streamingId}`;
    if (opened.current.has(key)) return;
    opened.current.add(key);
    useArtifactPanel.getState().open(threadId, streamingId, null);
  }, [live, streamingId, threadId]);

  // A reply that just finished with an artifact opens it too: one that arrived
  // while this chat was open, or one written in the last minute (a new chat's
  // first reply can finish before its page opens).
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!thread.data) return;
    const first = known.current === null;
    const seen = known.current ?? new Set<string>();
    known.current = seen;
    const fresh = messages.filter((message) => !seen.has(message.id));
    for (const message of messages) seen.add(message.id);
    const reply = fresh.findLast((message) => message.role === "assistant");
    if (!reply) return;
    if (first && Date.now() - new Date(reply.createdAt).getTime() > 60_000) return;
    const artifact = parseMessageSegments(reply.content).findLast(
      (segment) => segment.kind === "artifact",
    );
    if (artifact?.kind !== "artifact") return;
    const key = `${reply.id}:${artifact.identifier}`;
    if (opened.current.has(key)) return;
    opened.current.add(key);
    useArtifactPanel.getState().open(threadId, artifact.identifier, null);
  }, [messages, thread.data, threadId]);

  // The panel belongs to one chat.
  useEffect(() => {
    if (panel.threadKey && panel.threadKey !== threadId) panel.close();
  }, [panel, threadId]);
  const panelVersions =
    panel.threadKey === threadId && panel.identifier ? artifacts.get(panel.identifier) : undefined;
  const {
    ref: scrollRef,
    onScroll,
    pin,
  } = useStickToBottom<HTMLDivElement>(
    `${messages.length}:${live?.text.length ?? 0}:${live?.toolCalls.length ?? 0}:${live?.status}`,
  );

  if (!workspaceId || thread.isPending) {
    return (
      <div className="text-muted flex h-full items-center justify-center">
        <Spinner label="Loading chat" />
      </div>
    );
  }
  if (thread.isError) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-semibold">This chat isn&apos;t available</h1>
        <p className="text-muted">It may have been deleted, or it belongs to another workspace.</p>
        <Button asChild>
          <Link href="/chat">Start a new chat</Link>
        </Button>
      </div>
    );
  }

  const onSend = (content: string, attachments: Attachment[]) => {
    pin();
    setDecisionError(undefined);
    return send({
      threadId,
      content,
      attachments,
      knowledge,
      mode,
      ...(modelId ? { model: modelId } : {}),
    });
  };

  const onEdit = async (message: ChatMessage, content: string) => {
    pin();
    setDecisionError(undefined);
    const result = await send({
      threadId,
      content,
      attachments: message.attachments,
      editMessageId: message.id,
      knowledge,
      mode,
      ...(modelId ? { model: modelId } : {}),
    });
    if (!result.ok && result.error) {
      setDecisionError(chatErrorMessage(result.error.code, result.error.message));
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="sr-only">{thread.data.thread.title ?? "New chat"}</h1>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="relative min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-10 sm:px-6">
            <MessageList
              workspaceId={workspaceId}
              messages={messages}
              live={live}
              artifacts={artifactContext}
              onEdit={onEdit}
              onSwitchVersion={(message, position) => {
                void api.chat
                  .restoreVersion(workspaceId, threadId, message.id, position)
                  .then((thread) =>
                    queryClient.setQueryData(queryKeys.thread(workspaceId, threadId), thread),
                  )
                  .catch(() => setDecisionError("That version couldn't be shown. Try again."));
              }}
              onDecide={async (message, callId, approved) => {
                setDecisionError(undefined);
                pin();
                const result = await decide(threadId, message, callId, approved);
                if (!result.ok && result.error) {
                  setDecisionError(chatErrorMessage(result.error.code, result.error.message));
                }
              }}
            />
            {decisionError ? (
              <p role="alert" className="text-danger mt-4 text-sm">
                {decisionError}
              </p>
            ) : null}
          </div>
        </div>
        <div className="bg-surface mx-auto w-full max-w-3xl px-3 pt-1 pb-3 sm:px-6 sm:pb-5">
          <Composer
            workspaceId={workspaceId}
            modelId={modelId}
            onModelChange={setPicked}
            onSend={onSend}
            onStop={() => replyControllers.stop(threadId)}
            onVoice={
              startVoice
                ? () => startVoice({ threadId, ...(modelId ? { model: modelId } : {}) })
                : undefined
            }
            streaming={Boolean(live)}
            placeholder="Reply to Tessel"
          />
        </div>
      </div>
      {panelVersions?.length ? (
        // Beside the chat on wide screens; over it on phones.
        <div className="border-line fixed inset-0 z-30 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:w-[min(52%,56rem)] md:shrink-0 md:border-l md:pt-0 md:pb-0">
          <ArtifactPanel versions={panelVersions} />
        </div>
      ) : null}
    </div>
  );
}
