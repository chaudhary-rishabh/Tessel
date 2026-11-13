"use client";

import { ApiClientError } from "@tessel/api-client";
import { useApi, useSkills, useVoiceStatus } from "@tessel/api-client/react";
import { MAX_ATTACHMENTS_PER_MESSAGE, type Attachment } from "@tessel/contracts";
import { cn } from "@tessel/ui";
import { ArrowUp, AudioLines, Paperclip, Sparkles, Square, Users, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import type { SendResult } from "@/hooks/use-send-message";
import { MediaImage } from "@/components/media/media-image";
import { chatErrorMessage } from "@/lib/chat-errors";
import { useDocumentScope } from "@/lib/document-scope-store";
import { useImageReference } from "@/lib/image-reference-store";
import { suggestMode } from "@/lib/mode-suggestion";
import { useSkillPick } from "@/lib/skill-pick-store";
import { AttachmentChip } from "./attachment-chip";
import { DictationButton } from "./dictation-button";
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
  const voiceStatus = useVoiceStatus(workspaceId);
  const setMode = useChatPreferences((state) => state.setMode);
  const scope = useDocumentScope();
  const scoped = scope.for(workspaceId);
  const skills = useSkills(workspaceId);
  const picked = useSkillPick((state) => state.skill);
  const pickSkill = useSkillPick((state) => state.set);
  const clearSkill = useSkillPick((state) => state.clear);
  const [highlight, setHighlight] = useState(0);
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);
  // "/" at the start of the message offers skills, filtered by what follows it.
  const slash = /^\/([a-z0-9-]*)$/i.exec(text)?.[1];
  const skillOptions = useMemo(() => {
    if (slash === undefined) return [];
    const query = slash.toLowerCase();
    return (skills.data ?? [])
      .filter((skill) => skill.enabled)
      .filter((skill) => skill.name.includes(query) || skill.title.toLowerCase().includes(query))
      .slice(0, 8);
  }, [skills.data, slash]);
  const menuOpen = skillOptions.length > 0;
  const suggestion = mode === "auto" && !dismissedSuggestion ? suggestMode(text) : null;
  const imageId = useImageReference((state) => state.imageId);
  const clearImage = useImageReference((state) => state.clear);

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
    const sentImage = imageId;
    const sentSkill = picked;
    setError(undefined);
    setText("");
    setFiles([]);
    clearImage();
    setDismissedSuggestion(false);
    // The send reads the picked skill as it starts; clear it once it has.
    const sending = onSend(
      // The image being edited goes with the message, for the model to find.
      sentImage ? `[image:${sentImage}] ${content}` : content,
      ready.map((file) => file.attachment),
    );
    clearSkill();
    const result = await sending;
    if (!result.ok) {
      // Put the message back so nothing the user typed is lost.
      setText(content);
      setFiles(sentFiles);
      if (sentImage) useImageReference.getState().set(sentImage);
      if (sentSkill) useSkillPick.getState().set(sentSkill);
      if (result.error) setError(chatErrorMessage(result.error.code, result.error.message));
      textarea.current?.focus();
      return;
    }
    // Sent: the previews' local copies aren't needed any more.
    for (const file of sentFiles) if (file.localUrl) URL.revokeObjectURL(file.localUrl);
  }

  function choose(skill: { name: string; title: string }) {
    pickSkill({ name: skill.name, title: skill.title });
    setText("");
    setHighlight(0);
    textarea.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((current) => (current + step + skillOptions.length) % skillOptions.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.nativeEvent.isComposing) {
        event.preventDefault();
        choose(skillOptions[Math.min(highlight, skillOptions.length - 1)]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setText("");
        return;
      }
    }
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
        {scoped.length > 0 ? (
          <div className="flex items-center gap-2 px-1.5 pt-1 pb-1.5 text-sm">
            <span className="bg-accent/10 text-ink inline-flex min-w-0 items-center gap-1.5 rounded-full py-1 pr-1 pl-3">
              <span className="truncate">
                Searching {scoped.length === 1 ? scoped[0]!.filename : `${scoped.length} documents`}
              </span>
              <button
                type="button"
                aria-label="Search all documents"
                onClick={scope.clear}
                className="hover:bg-ink/10 focus-visible:outline-accent inline-flex size-6 items-center justify-center rounded-full focus-visible:outline-2"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </div>
        ) : null}
        {imageId ? (
          <div className="flex items-center gap-2.5 p-1.5 pb-2">
            <MediaImage
              workspaceId={workspaceId}
              mediaId={imageId}
              alt="The image to edit"
              className="border-line size-12 shrink-0 rounded-lg border"
            />
            <p className="text-muted min-w-0 flex-1 text-sm">
              Editing this image. Describe the change.
            </p>
            <button
              type="button"
              aria-label="Don't edit this image"
              onClick={clearImage}
              className="text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent inline-flex size-8 items-center justify-center rounded-md focus-visible:outline-2"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
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
        {picked ? (
          <div className="flex items-center gap-2 px-1.5 pt-1 pb-1.5 text-sm">
            <span className="bg-accent/10 text-ink inline-flex min-w-0 items-center gap-1.5 rounded-full py-1 pr-1 pl-3">
              <Sparkles className="text-accent size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Using {picked.title}</span>
              <button
                type="button"
                aria-label={`Don't use ${picked.title}`}
                onClick={clearSkill}
                className="hover:bg-ink/10 focus-visible:outline-accent inline-flex size-6 items-center justify-center rounded-full focus-visible:outline-2"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </div>
        ) : null}
        {suggestion ? (
          <div className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 px-2 pt-1 pb-1.5 text-sm">
            <span>Looks like several {suggestion === "team" ? "kinds of work" : "steps"}.</span>
            <button
              type="button"
              onClick={() => setMode(suggestion)}
              className="text-accent focus-visible:outline-accent inline-flex items-center gap-1 rounded font-medium hover:underline focus-visible:outline-2"
            >
              <Users className="size-3.5" aria-hidden="true" />
              Use {suggestion === "team" ? "Team" : "Plan"}
            </button>
            <button
              type="button"
              aria-label="Dismiss suggestion"
              onClick={() => setDismissedSuggestion(true)}
              className="hover:text-ink focus-visible:outline-accent ml-auto inline-flex size-6 items-center justify-center rounded focus-visible:outline-2"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {menuOpen ? (
          <ul
            id={`${inputId}-skills`}
            role="listbox"
            aria-label="Skills"
            className="border-line bg-surface mb-1 max-h-64 overflow-y-auto rounded-xl border p-1 shadow-md"
          >
            {skillOptions.map((skill, index) => (
              <li
                key={skill.id}
                id={`${inputId}-skill-${index}`}
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(skill);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  "cursor-pointer rounded-lg px-3 py-2",
                  index === highlight ? "bg-accent/10" : "hover:bg-ink/4",
                )}
              >
                <p className="text-sm font-medium">
                  {skill.title} <span className="text-muted font-normal">/{skill.name}</span>
                </p>
                <p className="text-muted truncate text-xs">{skill.description}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <label htmlFor={inputId} className="sr-only">
          Message
        </label>
        <textarea
          data-composer=""
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
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? `${inputId}-skills` : undefined}
          aria-activedescendant={menuOpen ? `${inputId}-skill-${highlight}` : undefined}
          aria-autocomplete="list"
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
          {voiceStatus.data?.dictation ? (
            <DictationButton
              workspaceId={workspaceId}
              onError={setError}
              onText={(spoken) => {
                setError(undefined);
                setText((current) => (current.trim() ? `${current.trimEnd()} ${spoken}` : spoken));
                textarea.current?.focus();
              }}
            />
          ) : null}
          <KnowledgePicker workspaceId={workspaceId} value={knowledge} onChange={setKnowledge} />
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
