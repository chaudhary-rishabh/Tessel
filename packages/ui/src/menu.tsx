"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

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

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("text-muted px-2.5 py-1.5 text-sm", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="bg-line my-1.5 h-px" />;
}
