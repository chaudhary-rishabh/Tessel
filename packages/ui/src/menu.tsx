"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuSub = Menu.Sub;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        className={cn(
          "border-line bg-surface text-ink z-50 min-w-56 rounded-xl border p-1.5 shadow-lg",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none select-none",
        "data-[highlighted]:bg-ink/6 data-[disabled]:cursor-default data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** A row that opens a second menu beside it, on hover, click, or the right arrow key. */
export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.SubTrigger>) {
  return (
    <Menu.SubTrigger
      className={cn(
        "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none select-none",
        "data-[highlighted]:bg-ink/6 data-[state=open]:bg-ink/6 data-[disabled]:cursor-default data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="text-muted ml-auto size-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 4 4 4-4 4" />
      </svg>
    </Menu.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Menu.SubContent>) {
  return (
    <Menu.Portal>
      <Menu.SubContent
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "border-line bg-surface text-ink z-50 min-w-56 rounded-xl border p-1.5 shadow-lg",
          "data-[state=open]:animate-[fade-in_120ms_ease-out] motion-reduce:animate-none",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("text-muted px-2.5 py-1.5 text-sm", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="bg-line my-1.5 h-px" />;
}
