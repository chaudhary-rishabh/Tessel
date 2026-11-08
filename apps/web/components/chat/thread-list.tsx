"use client";

import { useDeleteThread, useRenameThread, useThreads } from "@tessel/api-client/react";
import type { ThreadSummary } from "@tessel/contracts";
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
  TextField,
} from "@tessel/ui";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { useChatStore } from "@/lib/chat-store";

const titleOf = (thread: ThreadSummary) => thread.title ?? "New chat";

function RenameDialog({
  workspaceId,
  thread,
  onClose,
}: {
  workspaceId: string;
  thread: ThreadSummary;
  onClose: () => void;
}) {
  const rename = useRenameThread(workspaceId);
  const [title, setTitle] = useState(titleOf(thread));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Rename chat">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!title.trim()) return;
            await rename
              .mutateAsync({ threadId: thread.id, title: title.trim() })
              .then(onClose, () => undefined);
          }}
        >
          <FormError message={rename.error?.message} />
          <TextField
            label="Title"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={rename.isPending} disabled={!title.trim()}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  workspaceId,
  thread,
  onClose,
  onDeleted,
}: {
  workspaceId: string;
  thread: ThreadSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const remove = useDeleteThread(workspaceId);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Delete chat?"
        description={`"${titleOf(thread)}" and its messages will be deleted for good.`}
      >
        <FormError message={remove.error?.message} />
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutateAsync(thread.id).then(onDeleted, () => undefined)}
          >
            Delete chat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ThreadList({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate?: () => void;
}) {
  const threads = useThreads(workspaceId);
  const pathname = usePathname();
  const router = useRouter();
  const streaming = useChatStore((state) => state.replies);
  const [renaming, setRenaming] = useState<ThreadSummary>();
  const [deleting, setDeleting] = useState<ThreadSummary>();

  if (threads.isPending) return <p className="text-muted/80 mt-2 text-sm">Loading chats…</p>;
  if (threads.isError)
    return <p className="text-danger mt-2 text-sm">Chats couldn&apos;t be loaded.</p>;
  if (threads.data.threads.length === 0) {
    return <p className="text-muted/80 mt-2 text-sm">Your conversations will appear here.</p>;
  }

  return (
    <>
      <ul className="-mx-2 mt-1.5 flex flex-col gap-0.5">
        {threads.data.threads.map((thread) => {
          const href = `/chat/${thread.id}`;
          const active = pathname === href;
          return (
            <li key={thread.id} className="group relative">
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-ink/80 hover:bg-ink/6 hover:text-ink flex min-h-10 items-center rounded-lg py-1.5 pr-10 pl-2 text-sm",
                  "focus-visible:outline-accent focus-visible:outline-2",
                  active && "bg-ink/8 text-ink font-medium",
                )}
              >
                <span className="truncate">{titleOf(thread)}</span>
                {streaming[thread.id] ? (
                  <span
                    className="bg-accent ml-2 size-1.5 shrink-0 rounded-full"
                    aria-label="Replying"
                  />
                ) : null}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Options for ${titleOf(thread)}`}
                  className="text-muted hover:text-ink focus-visible:outline-accent absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md opacity-100 focus-visible:opacity-100 focus-visible:outline-2 data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                >
                  <Ellipsis className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                  <DropdownMenuItem onSelect={() => setRenaming(thread)}>
                    <Pencil className="size-4" aria-hidden="true" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDeleting(thread)} className="text-danger">
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
      {renaming ? (
        <RenameDialog
          workspaceId={workspaceId}
          thread={renaming}
          onClose={() => setRenaming(undefined)}
        />
      ) : null}
      {deleting ? (
        <DeleteDialog
          workspaceId={workspaceId}
          thread={deleting}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setDeleting(undefined);
            if (pathname === `/chat/${deleting.id}`) router.push("/chat");
          }}
        />
      ) : null}
    </>
  );
}
