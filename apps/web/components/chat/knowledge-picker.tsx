"use client";

import type { KnowledgeMode } from "@tessel/contracts";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tessel/ui";
import { BookOpen, Check } from "lucide-react";

const OPTIONS: { value: KnowledgeMode; label: string; description: string }[] = [
  {
    value: "auto",
    label: "When it helps",
    description: "Search documents when the question needs them",
  },
  { value: "always", label: "Always", description: "Search documents for every message" },
  { value: "off", label: "Off", description: "Answer without searching documents" },
];

/** When chat searches the workspace's documents. */
export function KnowledgePicker({
  value,
  onChange,
}: {
  value: KnowledgeMode;
  onChange: (value: KnowledgeMode) => void;
}) {
  const selected = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Use documents: ${selected.label}`}
        className={cn(
          "hover:bg-ink/6 focus-visible:outline-accent flex size-10 items-center justify-center rounded-lg focus-visible:outline-2",
          value === "off"
            ? "text-muted/60"
            : value === "always"
              ? "text-accent"
              : "text-muted hover:text-ink",
        )}
      >
        <BookOpen className="size-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <p className="text-muted px-2.5 pt-1 pb-1.5 text-xs font-medium">Use documents</p>
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className="items-start py-2"
          >
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
