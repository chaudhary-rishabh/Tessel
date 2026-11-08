"use client";

import type { AgentModeName } from "@tessel/contracts";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tessel/ui";
import {
  Check,
  ListChecks,
  MessageSquareText,
  ScanEye,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export const AGENT_MODE_OPTIONS: {
  value: AgentModeName;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    value: "auto",
    label: "Answer",
    description: "Reply straight away, using tools when they help",
    icon: MessageSquareText,
  },
  {
    value: "plan",
    label: "Plan",
    description: "Make a plan, work through each step, then answer",
    icon: ListChecks,
  },
  {
    value: "reflect",
    label: "Review",
    description: "Draft an answer, check it, and fix what's wrong",
    icon: ScanEye,
  },
  {
    value: "team",
    label: "Team",
    description: "Hand parts of the task to a researcher, analyst, and editor",
    icon: UsersRound,
  },
];

/** How the next reply is worked out. Anything but the default shows its name. */
export function ModePicker({
  value,
  onChange,
}: {
  value: AgentModeName;
  onChange: (value: AgentModeName) => void;
}) {
  const selected =
    AGENT_MODE_OPTIONS.find((option) => option.value === value) ?? AGENT_MODE_OPTIONS[0]!;
  const Icon = selected.icon;
  const active = value !== "auto";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Reply mode: ${selected.label}`}
        className={cn(
          "focus-visible:outline-accent flex h-10 items-center gap-1.5 rounded-lg focus-visible:outline-2",
          active
            ? "bg-accent/10 text-accent hover:bg-accent/15 px-2.5 text-sm font-medium"
            : "text-muted hover:text-ink hover:bg-ink/6 w-10 justify-center",
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        {active ? <span>{selected.label}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-76">
        <p className="text-muted px-2.5 pt-1 pb-1.5 text-xs font-medium">How to reply</p>
        {AGENT_MODE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className="items-start gap-2.5 py-2"
          >
            <option.icon className="text-muted mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{option.label}</p>
              <p className="text-muted text-xs">{option.description}</p>
            </div>
            {option.value === value ? (
              <Check className="text-accent mt-0.5 size-4 shrink-0" aria-label="Selected" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
