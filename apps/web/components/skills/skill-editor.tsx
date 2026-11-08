"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCreateSkill, useUpdateSkill } from "@tessel/api-client/react";
import { createSkillRequestSchema, type CreateSkillRequest, type Skill } from "@tessel/contracts";
import { Button, cn, Dialog, DialogClose, DialogContent, TextField } from "@tessel/ui";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { FormError } from "@/components/form-error";
import { applyApiError } from "@/lib/form-errors";

const FIELDS = ["title", "description", "instructions"] as const;

/** Writes a new skill, or edits one, in a dialog. */
export function SkillEditor({
  workspaceId,
  skill,
  onClose,
}: {
  workspaceId: string;
  skill?: Skill;
  onClose: () => void;
}) {
  const create = useCreateSkill(workspaceId);
  const update = useUpdateSkill(workspaceId);
  const instructionsId = useId();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateSkillRequest>({
    resolver: zodResolver(createSkillRequestSchema),
    defaultValues: skill
      ? { title: skill.title, description: skill.description, instructions: skill.instructions }
      : { title: "", description: "", instructions: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (skill) await update.mutateAsync({ skillId: skill.id, input: values });
      else await create.mutateAsync(values);
      onClose();
    } catch (error) {
      applyApiError(error, setError, FIELDS);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={skill ? `Edit ${skill.title}` : "New skill"}
        description="Tessel loads a skill when a request matches its description, then follows its instructions."
        className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto"
      >
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4" noValidate>
          <FormError message={errors.root?.server?.message} />
          <TextField
            label="Name"
            placeholder="Release notes"
            autoComplete="off"
            error={errors.title?.message}
            {...register("title")}
          />
          <TextField
            label="When to use it"
            hint="The agent reads this to decide when the skill applies."
            placeholder="Write release notes for a product update"
            autoComplete="off"
            error={errors.description?.message}
            {...register("description")}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={instructionsId} className="text-sm font-medium">
              Instructions
            </label>
            <textarea
              id={instructionsId}
              rows={10}
              aria-invalid={errors.instructions ? true : undefined}
              aria-describedby={errors.instructions ? `${instructionsId}-error` : undefined}
              placeholder={
                "Start with a one-line summary.\nGroup changes by area: new, improved, fixed.\nKeep each item to one line."
              }
              className={cn(
                "border-line bg-surface text-ink min-h-48 rounded-lg border px-3 py-2.5 font-mono text-sm leading-relaxed",
                "placeholder:text-muted/70 focus:border-accent focus:outline-accent/25 focus:outline-2",
                errors.instructions && "border-danger focus:border-danger focus:outline-danger/25",
              )}
              {...register("instructions")}
            />
            {errors.instructions ? (
              <p id={`${instructionsId}-error`} className="text-danger text-sm">
                {errors.instructions.message}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={isSubmitting}>
              {skill ? "Save changes" : "Create skill"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
