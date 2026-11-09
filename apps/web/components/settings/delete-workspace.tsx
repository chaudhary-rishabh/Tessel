"use client";

import { useDeleteWorkspace } from "@tessel/api-client/react";
import type { Workspace } from "@tessel/contracts";
import { Button, Dialog, DialogClose, DialogContent, TextField } from "@tessel/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { toast } from "@/lib/toast-store";

/** The owner's way to delete a team workspace, after typing its name. */
export function DeleteWorkspace({ workspace }: { workspace: Workspace }) {
  const remove = useDeleteWorkspace();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const matches = name.trim() === workspace.name;

  return (
    <div className="border-danger/30 mt-6 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-base font-semibold">Delete this workspace</h3>
        <p className="text-muted mt-0.5 text-sm">
          Removes its chats, documents, skills, connectors, and members for good, and ends its plan
          straight away.
        </p>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setName("");
            remove.reset();
          }
        }}
      >
        <Button variant="danger" className="shrink-0" onClick={() => setOpen(true)}>
          Delete workspace
        </Button>
        <DialogContent
          title={`Delete ${workspace.name}?`}
          description="Everything in it is deleted for everyone, and can't be brought back."
        >
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!matches) return;
              try {
                await remove.mutateAsync({ workspaceId: workspace.id, name: name.trim() });
                setOpen(false);
                toast.success(`${workspace.name} was deleted`);
                router.push("/chat");
              } catch {
                // The error shows in the dialog.
              }
            }}
          >
            <FormError message={remove.error?.message} />
            <TextField
              label={`Type ${workspace.name} to confirm`}
              value={name}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="danger" loading={remove.isPending} disabled={!matches}>
                Delete workspace
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
