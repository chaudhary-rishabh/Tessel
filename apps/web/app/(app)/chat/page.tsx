"use client";

import type { Attachment } from "@tessel/contracts";
import { useSyncExternalStore } from "react";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { useChatModel } from "@/hooks/use-chat-model";
import { useChatPreferences } from "@/lib/chat-preferences";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { useSendMessage } from "@/hooks/use-send-message";
import { useStartVoice } from "@/hooks/use-voice";
import { replyControllers, useChatStore } from "@/lib/chat-store";
import { useSessionStore } from "@/lib/session-store";

function greetingFor(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// The hour comes from the browser's clock; the server renders a neutral greeting.
const subscribe = () => () => undefined;
const useGreeting = () =>
  useSyncExternalStore(
    subscribe,
    () => greetingFor(new Date().getHours()),
    () => "Welcome",
  );

export default function NewChatPage() {
  const user = useSessionStore((state) => state.user);
  const { current } = useCurrentWorkspace();
  const greeting = useGreeting();
  const firstName = user?.name.split(/\s+/)[0] ?? "";
  const knowledge = useChatPreferences((state) => state.knowledge);
  const mode = useChatPreferences((state) => state.mode);
  const send = useSendMessage(current?.id);
  const { modelId, setModelId } = useChatModel();
  const startVoice = useStartVoice(current?.id);
  // A new chat waiting for the server to create it (the page then moves to the chat).
  const pending = useChatStore((state) =>
    Object.values(state.replies).find((reply) => reply.threadId === null),
  );

  if (!current) return null;

  const onSend = (content: string, attachments: Attachment[]) =>
    send({ content, attachments, knowledge, mode, ...(modelId ? { model: modelId } : {}) });

  // The composer stays mounted while a message is pending, so a refused
  // message can be put back into it.
  return (
    <div
      className={
        pending
          ? "mx-auto flex min-h-full w-full max-w-3xl flex-col justify-between gap-6 px-4 pt-6 pb-3 sm:px-6 sm:pb-5"
          : "mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-8 px-4 py-10 sm:px-6"
      }
    >
      {pending ? (
        <MessageList
          workspaceId={current.id}
          messages={[]}
          live={pending}
          // The chat opens on its own page as soon as it exists; artifacts open there.
          artifacts={{ threadKey: "new", versionOf: () => 1 }}
        />
      ) : (
        <h1 className="text-center text-3xl font-medium tracking-tight sm:text-4xl">
          {greeting}, {firstName}
        </h1>
      )}
      <Composer
        workspaceId={current.id}
        modelId={modelId}
        onModelChange={setModelId}
        onSend={onSend}
        onStop={() => (pending ? replyControllers.stop(pending.key) : undefined)}
        onVoice={startVoice ? () => startVoice(modelId ? { model: modelId } : {}) : undefined}
        streaming={Boolean(pending)}
        placeholder="How can I help today?"
        autoFocus
      />
    </div>
  );
}
