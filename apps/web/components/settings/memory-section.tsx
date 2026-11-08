"use client";

import { useMemory, useMemoryActions } from "@tessel/api-client/react";
import type { Memory } from "@tessel/contracts";
import { Button, cn, Dialog, DialogClose, DialogContent, Spinner } from "@tessel/ui";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";

const SOURCE: Record<Memory["source"], string> = {
  chat: "Noticed in a chat",
  tool: "You asked Tessel to remember",
  user: "Added by you",
};

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted text-xs">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "focus-visible:outline-accent relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 motion-reduce:transition-none",
          checked ? "bg-accent" : "bg-line",
        )}
      >
        <span
          className={cn(
            "bg-surface absolute top-0.5 left-0.5 size-5 rounded-full shadow transition-transform motion-reduce:transition-none",
            checked && "translate-x-4",
          )}
        />
      </button>
    </div>
  );
}

function MemoryRow({ workspaceId, memory }: { workspaceId: string; memory: Memory }) {
  const { update, remove } = useMemoryActions(workspaceId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);

  async function save(event: FormEvent) {
    event.preventDefault();
    await update.mutateAsync({ memoryId: memory.id, content: draft });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="py-3">
        <form onSubmit={save} className="flex items-start gap-2">
          <label className="sr-only" htmlFor={`memory-${memory.id}`}>
            Edit memory
          </label>
          <textarea
            id={`memory-${memory.id}`}
            value={draft}
            maxLength={300}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            className="border-line bg-surface focus:border-accent focus:outline-accent/25 min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-2"
          />
          <Button
            type="submit"
            size="icon"
            variant="ghost"
            aria-label="Save memory"
            loading={update.isPending}
          >
            <Check className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Cancel editing"
            onClick={() => {
              setDraft(memory.content);
              setEditing(false);
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </form>
        {update.error ? <p className="text-danger mt-1 text-xs">{update.error.message}</p> : null}
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm [overflow-wrap:anywhere]">{memory.content}</p>
        <p className="text-muted text-xs">{SOURCE[memory.source]}</p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Edit "${memory.content}"`}
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="text-danger"
        aria-label={`Delete "${memory.content}"`}
        loading={remove.isPending}
        onClick={() => remove.mutate(memory.id)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

/** What Tessel remembers about the user in this workspace, and the switches for it. */
export function MemorySection({ workspaceId }: { workspaceId: string }) {
  const memory = useMemory(workspaceId);
  const { saveSettings, add, clear } = useMemoryActions(workspaceId);
  const [draft, setDraft] = useState("");
  const [clearing, setClearing] = useState(false);

  if (memory.isPending) return <Spinner label="Loading memory" />;
  if (memory.isError) return <p className="text-danger text-sm">Memory couldn&apos;t be loaded.</p>;
  const { settings, memories } = memory.data;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    await add.mutateAsync(draft);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        <Toggle
          label="Remember things about me"
          description="Tessel notes lasting facts and preferences from your chats and uses them in new ones."
          checked={settings.memoryEnabled}
          disabled={saveSettings.isPending}
          onChange={(value) => saveSettings.mutate({ memoryEnabled: value })}
        />
        <Toggle
          label="Search my past chats"
          description="When you mention an earlier conversation, Tessel can look it up. Turning this off removes the search index."
          checked={settings.chatSearchEnabled}
          disabled={saveSettings.isPending}
          onChange={(value) => saveSettings.mutate({ chatSearchEnabled: value })}
        />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="new-memory">
          Add a memory
        </label>
        <input
          id="new-memory"
          value={draft}
          maxLength={300}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Something Tessel should remember, like your role"
          className="border-line bg-surface focus:border-accent focus:outline-accent/25 h-11 min-w-0 flex-1 rounded-lg border px-3 text-base focus:outline-2"
        />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={!draft.trim()}>
          Add memory
        </Button>
      </form>
      {add.error ? <FormError message={add.error.message} /> : null}

      {memories.length === 0 ? (
        <p className="text-muted text-sm">Nothing remembered yet.</p>
      ) : (
        <>
          <ul className="divide-line border-line divide-y border-y" aria-label="Memories">
            {memories.map((item) => (
              <MemoryRow key={item.id} workspaceId={workspaceId} memory={item} />
            ))}
          </ul>
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={() => setClearing(true)}
            >
              Delete all memories
            </Button>
          </div>
        </>
      )}

      {clearing ? (
        <Dialog open onOpenChange={(open) => !open && setClearing(false)}>
          <DialogContent
            title="Delete all memories?"
            description="Tessel forgets everything it remembered about you in this workspace. Your chats stay."
          >
            <div className="mt-6 flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                loading={clear.isPending}
                onClick={() => clear.mutate(undefined, { onSuccess: () => setClearing(false) })}
              >
                Delete all
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
