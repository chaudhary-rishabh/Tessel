"use client";

import { useTeamMemory, useTeamMemoryActions } from "@tessel/api-client/react";
import type { TeamMemory } from "@tessel/contracts";
import { Button, Spinner } from "@tessel/ui";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";

function TeamMemoryRow({ workspaceId, memory }: { workspaceId: string; memory: TeamMemory }) {
  const { update, remove } = useTeamMemoryActions(workspaceId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const fieldId = useId();

  async function save(event: FormEvent) {
    event.preventDefault();
    const saved = await update.mutateAsync({ memoryId: memory.id, content: draft }).then(
      () => true,
      () => false,
    );
    if (saved) setEditing(false);
  }

  if (editing) {
    return (
      <li className="py-3">
        <form onSubmit={save} className="flex items-start gap-2">
          <label className="sr-only" htmlFor={fieldId}>
            Edit team memory
          </label>
          <textarea
            id={fieldId}
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
            aria-label="Save"
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
        <p className="text-muted text-xs">
          {memory.mine ? "Added by you" : `Added by ${memory.authorName ?? "a former member"}`}
        </p>
      </div>
      {memory.canEdit ? (
        <>
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
        </>
      ) : null}
    </li>
  );
}

/** Facts the whole team shares, used in everyone's replies in this workspace. */
export function TeamMemorySection({ workspaceId }: { workspaceId: string }) {
  const memories = useTeamMemory(workspaceId, true);
  const { add } = useTeamMemoryActions(workspaceId);
  const [draft, setDraft] = useState("");
  const fieldId = useId();

  if (memories.isPending) return <Spinner label="Loading team memory" />;
  if (memories.isError) {
    return <p className="text-danger text-sm">Team memory couldn&apos;t be loaded.</p>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    const added = await add.mutateAsync(draft).then(
      () => true,
      () => false,
    );
    if (added) setDraft("");
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor={fieldId}>
          Add to team memory
        </label>
        <input
          id={fieldId}
          value={draft}
          maxLength={300}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Something everyone's replies should know, like a project name"
          className="border-line bg-surface focus:border-accent focus:outline-accent/25 h-11 min-w-0 flex-1 rounded-lg border px-3 text-base focus:outline-2"
        />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={!draft.trim()}>
          Add for the team
        </Button>
      </form>
      {add.error ? <FormError message={add.error.message} /> : null}
      {memories.data.length === 0 ? (
        <p className="text-muted text-sm">
          Nothing yet. Add your team&apos;s projects, conventions, and decisions, or ask Tessel in a
          chat to remember something for the team.
        </p>
      ) : (
        <ul className="divide-line border-line divide-y border-y" aria-label="Team memory">
          {memories.data.map((item) => (
            <TeamMemoryRow key={item.id} workspaceId={workspaceId} memory={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
