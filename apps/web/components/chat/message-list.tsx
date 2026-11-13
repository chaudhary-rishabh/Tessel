"use client";

import { parseMessageSegments, type ChatMessage } from "@tessel/contracts";
import { ArtifactCard } from "@/components/artifacts/artifact-card";
import { useModels } from "@tessel/api-client/react";
import { Button } from "@tessel/ui";
import { AudioLines, CircleAlert, Pencil, RotateCcw } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { chatErrorMessage } from "@/lib/chat-errors";
import type { LiveReply } from "@/lib/chat-store";
import { AttachmentChip } from "./attachment-chip";
import { SourceList } from "./citations";
import { CopyButton, Markdown } from "./markdown";
import { ActivityPanel } from "./activity";
import { ReadAloudButton } from "./read-aloud";
import { ApprovalCard, ToolCallList } from "./tool-calls";

const ACTION =
  "text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent inline-flex size-8 items-center justify-center rounded-md focus-visible:outline-2";

function EditForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const fieldId = useId();
  const trimmed = text.trim();
  return (
    <form
      className="border-line bg-surface flex w-full max-w-[85%] flex-col gap-2 rounded-2xl border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSave(trimmed);
      }}
    >
      <label htmlFor={fieldId} className="sr-only">
        New text for this message
      </label>
      <textarea
        id={fieldId}
        autoFocus
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (trimmed) onSave(trimmed);
          }
        }}
        className="w-full resize-none bg-transparent text-base outline-none"
      />
      <p className="text-muted text-xs">Replies after this message will be replaced.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!trimmed}>
          Send edit
        </Button>
      </div>
    </form>
  );
}

function UserMessage({
  workspaceId,
  message,
  onEdit,
}: {
  workspaceId: string;
  message: ChatMessage;
  onEdit?: ((content: string) => void) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  if (editing && onEdit) {
    return (
      <div className="flex flex-col items-end">
        <EditForm
          initial={message.content}
          onCancel={() => setEditing(false)}
          onSave={(content) => {
            setEditing(false);
            onEdit(content);
          }}
        />
      </div>
    );
  }
  return (
    <div className="group flex flex-col items-end gap-2">
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
      {message.voiceSessionId ? <Spoken /> : null}
      {onEdit ? (
        <div className="text-muted flex gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-within:opacity-100">
          <CopyButton text={message.content} label="Copy message" />
          <button
            type="button"
            className={ACTION}
            aria-label="Edit message"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Marks a message that was said in a voice conversation rather than typed. */
function Spoken() {
  return (
    <span className="text-muted inline-flex items-center gap-1 text-xs">
      <AudioLines className="size-3.5" aria-hidden="true" />
      Spoken
    </span>
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

/** Where a reply's artifacts open: the chat, and which version each one is. */
export interface ArtifactContext {
  threadKey: string;
  versionOf(messageId: string, identifier: string): number;
}

/** A reply's text, with any artifacts as cards that open beside the chat. */
function ReplyBody({
  content,
  sources,
  messageId,
  artifacts,
}: {
  content: string;
  sources: ChatMessage["sources"];
  messageId: string;
  artifacts?: ArtifactContext | undefined;
}) {
  const segments = useMemo(() => parseMessageSegments(content), [content]);
  if (!artifacts || !segments.some((segment) => segment.kind === "artifact")) {
    return <Markdown text={content} sources={sources} />;
  }
  return (
    <div>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <Markdown key={index} text={segment.text} sources={sources} />
        ) : (
          <ArtifactCard
            key={index}
            threadKey={artifacts.threadKey}
            artifact={segment}
            version={artifacts.versionOf(messageId, segment.identifier)}
          />
        ),
      )}
    </div>
  );
}

export type DecideHandler = (
  message: ChatMessage,
  callId: string,
  approved: boolean,
) => Promise<void> | void;

function AssistantMessage({
  message,
  messageId,
  artifacts,
  readAloud,
  streaming,
  searching,
  modelLabel,
  onDecide,
  onRetry,
}: {
  message: Pick<
    ChatMessage,
    "content" | "status" | "errorCode" | "sources" | "toolCalls" | "activity" | "agentMode"
  > & { voiceSessionId?: string | null };
  /** The reply's ID ("live" while it streams), for its artifacts' versions. */
  messageId: string;
  artifacts?: ArtifactContext | undefined;
  /** Where the saved reply lives, so it can be read aloud. */
  readAloud?: { workspaceId: string; messageId: string } | undefined;
  streaming?: boolean;
  searching?: boolean;
  modelLabel?: string | undefined;
  onDecide?: ((callId: string, approved: boolean) => Promise<void> | void) | undefined;
  /** Writes this reply again; offered on the last reply. */
  onRetry?: (() => void) | undefined;
}) {
  const hasText = message.content.length > 0;
  const pending =
    message.status === "waiting"
      ? message.toolCalls.find((call) => call.status === "waiting")
      : undefined;
  // While a step runs, its row shows progress; the dots are for before anything happens.
  const busy =
    message.toolCalls.some((call) => call.status === "running") ||
    message.activity.some((item) => item.status === "running");
  return (
    <div className="group flex flex-col gap-1.5" aria-busy={streaming || undefined}>
      <ActivityPanel
        items={message.activity}
        mode={message.agentMode}
        live={Boolean(streaming) || message.status === "waiting"}
      />
      <ToolCallList calls={message.toolCalls} />
      {hasText ? (
        <ReplyBody
          content={message.content}
          sources={message.sources}
          messageId={messageId}
          artifacts={artifacts}
        />
      ) : streaming && !busy ? (
        <Thinking searching={searching ?? false} />
      ) : null}
      {pending ? (
        <ApprovalCard
          call={pending}
          onDecide={onDecide ? (approved) => onDecide(pending.id, approved) : undefined}
        />
      ) : null}
      {!streaming ? <SourceList sources={message.sources} /> : null}
      {message.status === "error" ? (
        <p className="border-danger/40 text-danger flex items-start gap-2 rounded-xl border px-3 py-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {chatErrorMessage(message.errorCode)}
        </p>
      ) : null}
      {!streaming && (hasText || onRetry) ? (
        <div className="text-muted flex items-center gap-2 text-xs">
          {hasText ? <CopyButton text={message.content} label="Copy reply" /> : null}
          {hasText && readAloud && message.status === "complete" ? (
            <ReadAloudButton workspaceId={readAloud.workspaceId} messageId={readAloud.messageId} />
          ) : null}
          {onRetry ? (
            <button type="button" className={ACTION} aria-label="Retry reply" onClick={onRetry}>
              <RotateCcw className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          {message.status === "stopped" ? <span>Stopped</span> : null}
          {message.voiceSessionId ? <Spoken /> : null}
          {modelLabel ? (
            <span className="transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100">
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
  artifacts,
  onDecide,
  onEdit,
}: {
  workspaceId: string;
  messages: ChatMessage[];
  live?: LiveReply | undefined;
  /** Opens replies' artifacts beside the chat; without it they show inline as text. */
  artifacts?: ArtifactContext | undefined;
  /** Approves or declines the action a reply is waiting on. */
  onDecide?: DecideHandler | undefined;
  /** Rewrites the chat from a user message; the same text regenerates the reply. */
  onEdit?: ((message: ChatMessage, content: string) => void) | undefined;
}) {
  const models = useModels();
  const labelFor = (id: string | null) =>
    models.data?.models.find((model) => model.id === id)?.label;
  // Until the server confirms, the user's message is shown from the live reply.
  const pendingUser =
    live && live.status === "sending" ? (live.userMessage ?? undefined) : undefined;
  // Edits and retries wait while a reply streams or an action waits for a decision.
  const canRewrite = Boolean(onEdit) && !live && messages.at(-1)?.status !== "waiting";
  const lastUser = messages.findLast((message) => message.role === "user");
  const last = messages.at(-1);

  return (
    <ol className="flex flex-col gap-8" aria-label="Messages">
      {messages.map((message) => (
        <li key={message.id}>
          {message.role === "user" ? (
            <UserMessage
              workspaceId={workspaceId}
              message={message}
              onEdit={canRewrite ? (content) => onEdit?.(message, content) : undefined}
            />
          ) : (
            <AssistantMessage
              message={message}
              messageId={message.id}
              artifacts={artifacts}
              readAloud={{ workspaceId, messageId: message.id }}
              modelLabel={labelFor(message.modelId)}
              onRetry={
                canRewrite && lastUser && message.id === last?.id
                  ? () => onEdit?.(lastUser, lastUser.content)
                  : undefined
              }
              // Only one decision at a time, and not while another reply streams.
              onDecide={
                onDecide && !live
                  ? (callId, approved) => onDecide(message, callId, approved)
                  : undefined
              }
            />
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
            messageId="live"
            artifacts={artifacts}
            message={{
              content: live.text,
              status: "streaming",
              errorCode: null,
              sources: live.sources,
              toolCalls: live.toolCalls,
              activity: live.activity,
              agentMode: live.agentMode,
            }}
            streaming
            searching={live.stage === "searching"}
          />
        </li>
      ) : null}
    </ol>
  );
}
