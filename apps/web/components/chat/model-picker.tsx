"use client";

import { useModels } from "@tessel/api-client/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tessel/ui";
import { Check, ChevronDown } from "lucide-react";

export function ModelPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (modelId: string) => void;
}) {
  const models = useModels();
  const list = models.data?.models ?? [];
  const selected =
    list.find((model) => model.id === value) ??
    list.find((m) => m.id === models.data?.defaultModel);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Model: ${selected?.label ?? "loading"}`}
        disabled={!selected}
        className="text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent flex h-9 max-w-48 items-center gap-1 rounded-lg px-2.5 text-sm focus-visible:outline-2 disabled:opacity-50"
      >
        <span className="truncate">{selected?.label ?? "Model"}</span>
        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[min(28rem,70dvh)] w-72 overflow-y-auto">
        {list.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onSelect={() => onChange(model.id)}
            className="items-start py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-medium">
                {model.label}
                {model.tier === "pro" ? (
                  <span className="border-line text-muted rounded border px-1 text-xs font-normal">
                    Pro
                  </span>
                ) : null}
              </p>
              <p className="text-muted text-xs">{model.description}</p>
            </div>
            {model.id === selected?.id ? (
              <Check className="text-accent mt-0.5 size-4 shrink-0" aria-label="Selected" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
