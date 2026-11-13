"use client";

import type { KnowledgeMode } from "@tessel/contracts";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tessel/ui";
import { BookOpen, Check, ListChecks } from "lucide-react";
import { useState } from "react";
import { useDocumentScope } from "@/lib/document-scope-store";
import { DocumentChooser } from "./document-chooser";

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
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: KnowledgeMode;
  onChange: (value: KnowledgeMode) => void;
}) {
  const selected = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0]!;
  const [choosing, setChoosing] = useState(false);
  const scoped = useDocumentScope((state) => state.for(workspaceId).length);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Use documents: ${selected.label}`}
          className={cn(
            "hover:bg-ink/6 focus-visible:outline-accent flex size-10 items-center justify-center rounded-lg focus-visible:outline-2",
            value === "off"
              ? "text-muted/60"
              : value === "always" || scoped > 0
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
          <DropdownMenuItem onSelect={() => setChoosing(true)} className="items-start py-2">
            <ListChecks className="text-muted mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Choose documents…</p>
              <p className="text-muted text-xs">
                {scoped > 0
                  ? `Searching ${scoped} document${scoped === 1 ? "" : "s"}`
                  : "Search only the ones you pick"}
              </p>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {choosing ? (
        <DocumentChooser workspaceId={workspaceId} onClose={() => setChoosing(false)} />
      ) : null}
    </>
  );
}
