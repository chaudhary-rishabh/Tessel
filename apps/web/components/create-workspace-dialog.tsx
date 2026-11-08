"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCreateWorkspace } from "@tessel/api-client/react";
import { createWorkspaceRequestSchema } from "@tessel/contracts";
import { Button, Dialog, DialogClose, DialogContent, TextField } from "@tessel/ui";
import { useForm } from "react-hook-form";
import { applyApiError } from "@/lib/form-errors";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { FormError } from "./form-error";

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createWorkspace = useCreateWorkspace();
  const setCurrentWorkspace = useWorkspaceStore((state) => state.setCurrentWorkspace);
  const form = useForm({
    resolver: zodResolver(createWorkspaceRequestSchema),
    defaultValues: { name: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ name }) => {
    try {
      const workspace = await createWorkspace.mutateAsync(name);
      setCurrentWorkspace(workspace.id);
      form.reset();
      onOpenChange(false);
    } catch (error) {
      applyApiError(error, form.setError, ["name"]);
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        title="New workspace"
        description="A shared space for a team or project. You'll be its owner."
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <FormError message={errors.root?.server?.message} />
          <TextField
            label="Workspace name"
            placeholder="Platform team"
            autoComplete="off"
            error={errors.name?.message}
            {...form.register("name")}
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={isSubmitting}>
              Create workspace
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
