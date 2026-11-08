"use client";

import { useThread } from "@tessel/api-client/react";
import type { Attachment } from "@tessel/contracts";
import { Button, Spinner } from "@tessel/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { useChatModel } from "@/hooks/use-chat-model";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { useSendMessage } from "@/hooks/use-send-message";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { replyControllers, useChatStore } from "@/lib/chat-store";

export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const { current } = useCurrentWorkspace();
  const workspaceId = current?.id;
  const thread = useThread(workspaceId, threadId);
  const live = useChatStore((state) => state.replies[threadId]);
  const send = useSendMessage(workspaceId);
  const { modelId: defaultModel } = useChatModel(thread.data?.thread.modelId);
  // A pick made in this chat applies to its next messages.
  const [picked, setPicked] = useState<string>();
  const modelId = picked ?? defaultModel;
  const messages = thread.data?.messages ?? [];
  const {
    ref: scrollRef,
    onScroll,
    pin,
  } = useStickToBottom<HTMLDivElement>(
    `${messages.length}:${live?.text.length ?? 0}:${live?.status}`,
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
    return send({ threadId, content, attachments, ...(modelId ? { model: modelId } : {}) });
  };

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">{thread.data.thread.title ?? "New chat"}</h1>
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-10 sm:px-6">
          <MessageList workspaceId={workspaceId} messages={messages} live={live} />
        </div>
      </div>
      <div className="bg-surface mx-auto w-full max-w-3xl px-3 pt-1 pb-3 sm:px-6 sm:pb-5">
        <Composer
          workspaceId={workspaceId}
          modelId={modelId}
          onModelChange={setPicked}
          onSend={onSend}
          onStop={() => replyControllers.stop(threadId)}
          streaming={Boolean(live)}
          placeholder="Reply to Tessel"
        />
      </div>
    </div>
  );
}
