"use client";

import { useDeleteSkill, useSkills, useUpdateSkill } from "@tessel/api-client/react";
import type { Skill } from "@tessel/contracts";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
} from "@tessel/ui";
import { ChevronRight, Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { SkillEditor } from "@/components/skills/skill-editor";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";

function EnabledSwitch({ workspaceId, skill }: { workspaceId: string; skill: Skill }) {
  const update = useUpdateSkill(workspaceId);
  const on = update.isPending ? !skill.enabled : skill.enabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Use ${skill.title}`}
      disabled={!skill.canEdit || update.isPending}
      onClick={() => update.mutate({ skillId: skill.id, input: { enabled: !skill.enabled } })}
      className={cn(
        "focus-visible:outline-accent relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 motion-reduce:transition-none",
        on ? "bg-accent" : "bg-line",
      )}
    >
      <span
        className={cn(
          "bg-surface absolute top-0.5 left-0.5 size-5 rounded-full shadow transition-transform motion-reduce:transition-none",
          on && "translate-x-4",
        )}
      />
    </button>
  );
}

function Instructions({ skill }: { skill: Skill }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-accent focus-visible:outline-accent inline-flex items-center gap-1 rounded text-sm font-medium hover:underline focus-visible:outline-2"
      >
        <ChevronRight
          className={cn(
            "size-4 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden
        />
        {open ? "Hide instructions" : "Show instructions"}
      </button>
      {open ? (
        <pre className="bg-paper mt-2 max-h-80 overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {skill.instructions}
        </pre>
      ) : null}
    </div>
  );
}

function SkillRow({
  workspaceId,
  skill,
  onEdit,
  onDelete,
}: {
  workspaceId: string;
  skill: Skill;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className="flex items-start gap-3 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {skill.title}{" "}
          <span className="text-muted ml-1 font-mono text-xs font-normal">{skill.name}</span>
        </p>
        <p className="text-muted mt-0.5 text-sm">{skill.description}</p>
        {skill.author ? (
          <p className="text-muted mt-0.5 text-xs">Written by {skill.author.name}</p>
        ) : null}
        <Instructions skill={skill} />
      </div>
      {skill.builtIn ? (
        <span className="text-muted shrink-0 pt-0.5 text-xs">Built in</span>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <EnabledSwitch workspaceId={workspaceId} skill={skill} />
          {skill.canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Options for ${skill.title}`}
                className="text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent flex size-10 items-center justify-center rounded-lg focus-visible:outline-2"
              >
                <Ellipsis className="size-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem className="text-danger" onSelect={onDelete}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      )}
    </li>
  );
}

export default function SkillsPage() {
  const { current } = useCurrentWorkspace();
  const skills = useSkills(current?.id);
  const remove = useDeleteSkill(current?.id ?? "");
  const [editing, setEditing] = useState<Skill | "new">();
  const [deleting, setDeleting] = useState<Skill>();
  if (!current) return null;

  const own = skills.data?.filter((skill) => !skill.builtIn) ?? [];
  const builtIn = skills.data?.filter((skill) => skill.builtIn) ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 md:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Skills</h1>
          <p className="text-muted mt-2 max-w-prose">
            Instructions for the kinds of work your team repeats. When a request matches a skill,
            Tessel loads it and follows it.
          </p>
        </div>
        <Button onClick={() => setEditing("new")} className="gap-2">
          <Plus className="size-4" aria-hidden="true" />
          New skill
        </Button>
      </div>

      {skills.isPending ? (
        <div className="mt-10">
          <Spinner label="Loading skills" />
        </div>
      ) : skills.isError ? (
        <p className="text-danger mt-10 text-sm">
          Skills couldn&apos;t be loaded. Refresh to try again.
        </p>
      ) : (
        <>
          <section aria-labelledby="workspace-skills" className="mt-10">
            <h2 id="workspace-skills" className="text-lg font-semibold">
              {current.name}&apos;s skills
            </h2>
            {own.length === 0 ? (
              <p className="text-muted mt-3 text-sm">
                No skills yet. Write one for a task your team does often, like release notes or a
                weekly update.
              </p>
            ) : (
              <ul
                className="divide-line border-line mt-3 divide-y border-y"
                aria-label="Workspace skills"
              >
                {own.map((skill) => (
                  <SkillRow
                    key={skill.id}
                    workspaceId={current.id}
                    skill={skill}
                    onEdit={() => setEditing(skill)}
                    onDelete={() => setDeleting(skill)}
                  />
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="builtin-skills" className="mt-10">
            <h2 id="builtin-skills" className="text-lg font-semibold">
              Built in
            </h2>
            <ul
              className="divide-line border-line mt-3 divide-y border-y"
              aria-label="Built-in skills"
            >
              {builtIn.map((skill) => (
                <SkillRow key={skill.id} workspaceId={current.id} skill={skill} />
              ))}
            </ul>
          </section>
        </>
      )}

      {editing ? (
        <SkillEditor
          workspaceId={current.id}
          {...(editing === "new" ? {} : { skill: editing })}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      {deleting ? (
        <Dialog open onOpenChange={(open) => !open && setDeleting(undefined)}>
          <DialogContent
            title="Delete skill?"
            description={`"${deleting.title}" will be removed for everyone in ${current.name}.`}
          >
            <FormError message={remove.error?.message} />
            <div className={cn("flex justify-end gap-2", remove.error ? "mt-4" : "mt-6")}>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) })
                }
              >
                Delete skill
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
