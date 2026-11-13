"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return (
    <DialogPrimitive.Overlay className="bg-ink/30 fixed inset-0 z-40 data-[state=closed]:animate-[fade-out_180ms_ease-in] data-[state=open]:animate-[fade-in_150ms_ease-out] motion-reduce:animate-none" />
  );
}

export function DialogContent({
  title,
  description,
  children,
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
          "border-line bg-surface rounded-2xl border p-6 shadow-xl focus:outline-none",
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <DialogPrimitive.Title className="font-display text-ink text-xl font-semibold">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="text-muted mt-1">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        <div className="mt-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * A large rounded modal that is always open while it's rendered, such as a
 * route shown as a modal. Closing it (the close button, Escape, or a click
 * outside) calls `onClose`. A sheet from the bottom on phones, centered above.
 */
export function Modal({
  label,
  onClose,
  children,
  className,
}: {
  /** The modal's accessible name; the content shows its own visible heading. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bg-tile-ink/45 fixed inset-0 z-40 backdrop-blur-[3px] data-[state=open]:animate-[fade-in_200ms_ease-out] motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Focus the modal itself: its content may still be loading, which would
          // leave Close as the only thing to focus.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          className={cn(
            "bg-surface border-line fixed z-50 flex flex-col border shadow-2xl focus:outline-none",
            "inset-x-0 bottom-0 max-h-[94dvh] rounded-t-[1.75rem] pb-[env(safe-area-inset-bottom)]",
            "data-[state=open]:animate-[sheet-up_260ms_cubic-bezier(0.2,0.8,0.2,1)]",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[min(46rem,92dvh)] sm:w-[calc(100%-2rem)] sm:max-w-[27rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.75rem] sm:pb-0",
            "sm:data-[state=open]:animate-[modal-in_220ms_cubic-bezier(0.2,0.8,0.2,1)]",
            "motion-reduce:animate-none sm:motion-reduce:animate-none",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          <div className="bg-line mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full sm:hidden" />
          <div className="overflow-y-auto px-6 pt-4 pb-7 sm:px-9 sm:pt-9 sm:pb-9">{children}</div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="text-muted hover:bg-ink/6 hover:text-ink focus-visible:outline-accent absolute top-3 right-3 grid size-10 place-items-center rounded-full transition-colors focus-visible:outline-2 sm:top-4 sm:right-4"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A panel that slides in from the left: the sidebar on small screens. */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <Overlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "bg-paper fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col shadow-xl focus:outline-none",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "data-[state=closed]:animate-[slide-out_200ms_cubic-bezier(0.4,0,1,1)] data-[state=open]:animate-[slide-in_260ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
