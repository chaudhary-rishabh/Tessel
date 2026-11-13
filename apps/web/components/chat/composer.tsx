"use client";

import { ApiClientError } from "@tessel/api-client";
import { useApi } from "@tessel/api-client/react";
import { MAX_ATTACHMENTS_PER_MESSAGE, type Attachment } from "@tessel/contracts";
import { cn } from "@tessel/ui";
import { ArrowUp, AudioLines, Paperclip, Square } from "lucide-react";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { SendResult } from "@/hooks/use-send-message";
import { chatErrorMessage } from "@/lib/chat-errors";
import { AttachmentChip } from "./attachment-chip";
import { useChatPreferences } from "@/lib/chat-preferences";
import { KnowledgePicker } from "./knowledge-picker";
import { ModePicker } from "./mode-picker";
import { ModelPicker } from "./model-picker";

interface PendingFile {
  localId: string;
  attachment: Attachment;
  localUrl?: string;
  uploaded: boolean;
  progress: number;
  error?: string;
}

const ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,.txt,.md,.csv,.json,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.sql,.sh,.toml,.log";

/** On phones Enter adds a new line; elsewhere it sends and Shift+Enter adds a line. */
const enterSends = () =>
  typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches;

export function Composer({
  workspaceId,
  modelId,
  onModelChange,
  onSend,
  onStop,
  onVoice,
  streaming = false,
  placeholder = "Message Tessel",
  autoFocus = false,
  className,
}: {
  workspaceId: string;
  modelId: string | undefined;
  onModelChange: (modelId: string) => void;
  onSend: (content: string, attachments: Attachment[]) => Promise<SendResult>;
  onStop?: () => void;
  /** Starts a voice conversation; offered in place of Send while nothing is typed. */
  onVoice?: (() => void) | undefined;
  streaming?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const api = useApi();
  const inputId = useId();
  const errorId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [error, setError] = useState<string>();
  const knowledge = useChatPreferences((state) => state.knowledge);
  const setKnowledge = useChatPreferences((state) => state.setKnowledge);
  const mode = useChatPreferences((state) => state.mode);
  const setMode = useChatPreferences((state) => state.setMode);

  // Grow with the text, up to a limit, then scroll.
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [text]);

  const uploading = files.some((file) => !file.uploaded && !file.error);
  const ready = files.filter((file) => file.uploaded);
  const canSend = text.trim().length > 0 && !uploading && !files.some((file) => file.error);

  function addFiles(list: FileList | File[]) {
    setError(undefined);
    const incoming = Array.from(list).slice(0, MAX_ATTACHMENTS_PER_MESSAGE - files.length);
    if (incoming.length < list.length)
      setError(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files.`);
    for (const file of incoming) {
      const localId = crypto.randomUUID();
      const isImage = file.type.startsWith("image/");
      const pending: PendingFile = {
        localId,
        attachment: {
          id: localId,
          filename: file.name || "pasted-image.png",
          mediaType: file.type,
          kind: isImage ? "image" : "text",
          sizeBytes: file.size,
        },
        ...(isImage ? { localUrl: URL.createObjectURL(file) } : {}),
        uploaded: false,
        progress: 0,
      };
      setFiles((current) => [...current, pending]);
      const update = (patch: Partial<PendingFile>) =>
        setFiles((current) =>
          current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
        );
      api.chat
        .upload(workspaceId, file, pending.attachment.filename, (progress) => update({ progress }))
        .then((attachment) => update({ attachment, uploaded: true }))
        .catch((uploadError: unknown) =>
          update({
            error: uploadError instanceof ApiClientError ? uploadError.message : "Upload failed",
          }),
        );
    }
  }

  function removeFile(localId: string) {
    setFiles((current) => {
      const file = current.find((item) => item.localId === localId);
      if (file?.localUrl) URL.revokeObjectURL(file.localUrl);
      return current.filter((item) => item.localId !== localId);
    });
  }

  async function submit() {
    if (streaming) {
      onStop?.();
      return;
    }
    if (!canSend) return;
    const content = text.trim();
    const sentFiles = files;
    setError(undefined);
    setText("");
    setFiles([]);
    const result = await onSend(
      content,
      ready.map((file) => file.attachment),
    );
    if (!result.ok) {
      // Put the message back so nothing the user typed is lost.
      setText(content);
      setFiles(sentFiles);
      if (result.error) setError(chatErrorMessage(result.error.code, result.error.message));
      textarea.current?.focus();
      return;
    }
    // Sent: the previews' local copies aren't needed any more.
    for (const file of sentFiles) if (file.localUrl) URL.revokeObjectURL(file.localUrl);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      enterSends()
    ) {
      event.preventDefault();
      void submit();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length > 0) {
      event.preventDefault();
      addFiles(pasted);
    }
  }

  return (
    <form
      className={cn("w-full", className)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <p id={errorId} role="alert" className="text-danger mb-2 px-1 text-sm">
          {error}
        </p>
      ) : null}
      <div className="border-line bg-surface focus-within:border-accent/60 rounded-2xl border p-2 shadow-sm transition-colors">
        {files.length > 0 ? (
          <div className="flex flex-wrap gap-2.5 p-1.5 pb-2">
            {files.map((file) => (
              <AttachmentChip
                key={file.localId}
                workspaceId={workspaceId}
                attachment={file.attachment}
                {...(file.localUrl ? { localUrl: file.localUrl } : {})}
                uploading={!file.uploaded}
                progress={file.progress}
                {...(file.error ? { error: file.error } : {})}
                onRemove={() => removeFile(file.localId)}
              />
            ))}
          </div>
        ) : null}
        <label htmlFor={inputId} className="sr-only">
          Message
        </label>
        <textarea
          ref={textarea}
          id={inputId}
          rows={1}
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          aria-describedby={error ? errorId : undefined}
          className="text-ink placeholder:text-muted/80 block max-h-60 min-h-11 w-full resize-none bg-transparent px-2 py-2 text-base focus:outline-none"
        />
        <div className="flex items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            data-testid="attach-input"
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={files.length >= MAX_ATTACHMENTS_PER_MESSAGE}
            aria-label="Attach files"
            className="text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent flex size-10 items-center justify-center rounded-lg focus-visible:outline-2 disabled:opacity-40"
          >
            <Paperclip className="size-5" aria-hidden="true" />
          </button>
          <KnowledgePicker value={knowledge} onChange={setKnowledge} />
          <ModePicker value={mode} onChange={setMode} />
          <div className="ml-auto flex items-center gap-1.5">
            <ModelPicker value={modelId} onChange={onModelChange} />
            {onVoice && !streaming && text.trim().length === 0 && files.length === 0 ? (
              <button
                type="button"
                onClick={onVoice}
                aria-label="Start voice conversation"
                className="bg-accent text-accent-ink hover:bg-accent-strong focus-visible:outline-accent flex size-10 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <AudioLines className="size-5" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!streaming && !canSend}
                aria-label={streaming ? "Stop response" : "Send message"}
                className="bg-accent text-accent-ink hover:bg-accent-strong focus-visible:outline-accent flex size-10 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
              >
                {streaming ? (
                  <Square className="size-4 fill-current" aria-hidden="true" />
                ) : (
                  <ArrowUp className="size-5" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
