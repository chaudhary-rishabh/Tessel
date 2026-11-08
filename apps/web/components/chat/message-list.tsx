"use client";

import type { ChatMessage } from "@tessel/contracts";
import { useModels } from "@tessel/api-client/react";
import { CircleAlert } from "lucide-react";
import { chatErrorMessage } from "@/lib/chat-errors";
import type { LiveReply } from "@/lib/chat-store";
import { AttachmentChip } from "./attachment-chip";
import { SourceList } from "./citations";
import { CopyButton, Markdown } from "./markdown";

function UserMessage({ workspaceId, message }: { workspaceId: string; message: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-2">
      {message.attachments.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-2">
          {message.attachments.map((attachment) => (
            <AttachmentChip key={attachment.id} workspaceId={workspaceId} attachment={attachment} />
          ))}
        </div>
      ) : null}
      <div className="bg-paper border-line max-w-[85%] rounded-2xl rounded-br-md border px-4 py-2.5 [overflow-wrap:anywhere] whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  );
}

function Thinking({ searching = false }: { searching?: boolean }) {
  return (
    <div
      className="text-muted flex h-7 items-center gap-1.5 text-sm"
      role="status"
      aria-label={searching ? "Searching your documents" : "Writing a reply"}
    >
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="bg-accent size-2 rounded-full motion-safe:animate-[pulse-dot_1.2s_ease-in-out_infinite]"
          style={{ animationDelay: `${dot * 0.15}s` }}
        />
      ))}
      {searching ? <span className="ml-1.5">Searching your documents</span> : null}
    </div>
  );
}

function AssistantMessage({
  message,
  streaming,
  searching,
  modelLabel,
}: {
  message: Pick<ChatMessage, "content" | "status" | "errorCode" | "sources">;
  streaming?: boolean;
  searching?: boolean;
  modelLabel?: string | undefined;
}) {
  const hasText = message.content.length > 0;
  return (
    <div className="group flex flex-col gap-1.5" aria-busy={streaming || undefined}>
      {hasText ? (
        <Markdown text={message.content} sources={message.sources} />
      ) : streaming ? (
        <Thinking searching={searching ?? false} />
      ) : null}
      {!streaming ? <SourceList sources={message.sources} /> : null}
      {message.status === "error" ? (
        <p className="border-danger/40 text-danger flex items-start gap-2 rounded-xl border px-3 py-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {chatErrorMessage(message.errorCode)}
        </p>
      ) : null}
      {!streaming && hasText ? (
        <div className="text-muted flex items-center gap-2 text-xs">
          <CopyButton text={message.content} label="Copy reply" />
          {message.status === "stopped" ? <span>Stopped</span> : null}
          {modelLabel ? (
            <span className="opacity-0 transition-opacity group-hover:opacity-100">
              {modelLabel}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MessageList({
  workspaceId,
  messages,
  live,
}: {
  workspaceId: string;
  messages: ChatMessage[];
  live?: LiveReply | undefined;
}) {
  const models = useModels();
  const labelFor = (id: string | null) =>
    models.data?.models.find((model) => model.id === id)?.label;
  // Until the server confirms, the user's message is shown from the live reply.
  const pendingUser = live && live.status === "sending" ? live.userMessage : undefined;

  return (
    <ol className="flex flex-col gap-8" aria-label="Messages">
      {messages.map((message) => (
        <li key={message.id}>
          {message.role === "user" ? (
            <UserMessage workspaceId={workspaceId} message={message} />
          ) : (
            <AssistantMessage message={message} modelLabel={labelFor(message.modelId)} />
          )}
        </li>
      ))}
      {pendingUser ? (
        <li>
          <UserMessage workspaceId={workspaceId} message={pendingUser} />
        </li>
      ) : null}
      {live ? (
        <li>
          <AssistantMessage
            message={{
              content: live.text,
              status: "streaming",
              errorCode: null,
              sources: live.sources,
            }}
            streaming
            searching={live.stage === "searching"}
          />
        </li>
      ) : null}
    </ol>
  );
}
