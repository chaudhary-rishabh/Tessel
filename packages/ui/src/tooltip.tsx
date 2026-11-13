"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "./cn";

/** Shares one hover delay across nearby tooltips, so moving along a toolbar shows them at once. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={250}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/**
 * A short label shown on hover and keyboard focus. The child keeps its own
 * accessible name; the tooltip only repeats it for sighted pointer users.
 * With `disabled` the child renders as it is.
 */
export function Tooltip({
  label,
  shortcut,
  side = "top",
  disabled = false,
  children,
}: {
  label: string;
  /** Shown after the label, dimmed (for example "Ctrl ."). */
  shortcut?: string | undefined;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
  children: ReactNode;
}) {
  if (disabled) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className={cn(
            "bg-ink text-paper z-50 flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium shadow-md select-none",
            "data-[state=delayed-open]:animate-[fade-in_120ms_ease-out] motion-reduce:animate-none",
          )}
        >
          {label}
          {shortcut ? <kbd className="text-paper/60 font-sans">{shortcut}</kbd> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
