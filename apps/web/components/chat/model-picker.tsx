"use client";

import { useModels } from "@tessel/api-client/react";
import type { ModelSummary, ReasoningEffort } from "@tessel/contracts";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@tessel/ui";
import { Brain, Check, ChevronDown, Eye, Gauge } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useChatPreferences } from "@/lib/chat-preferences";

/** How each model maker is named in the picker. Unknown makers fall back to their ID. */
const PROVIDERS: Record<string, { name: string; maker: string }> = {
  anthropic: { name: "Claude", maker: "Anthropic" },
  openai: { name: "OpenAI", maker: "OpenAI" },
  google: { name: "Gemini", maker: "Google" },
  deepseek: { name: "DeepSeek", maker: "DeepSeek" },
  xai: { name: "Grok", maker: "xAI" },
  minimax: { name: "MiniMax", maker: "MiniMax" },
  moonshotai: { name: "Kimi", maker: "Moonshot AI" },
  zai: { name: "GLM", maker: "Z.ai" },
  mistral: { name: "Mistral", maker: "Mistral AI" },
};

function providerInfo(id: string) {
  return PROVIDERS[id] ?? { name: id.charAt(0).toUpperCase() + id.slice(1), maker: id };
}

export const EFFORT_OPTIONS: { value: ReasoningEffort; label: string; description: string }[] = [
  { value: "low", label: "Low", description: "Quick answers with light thinking" },
  { value: "medium", label: "Medium", description: "Balanced, for most questions" },
  { value: "high", label: "High", description: "Thinks longest, for hard problems" },
];

const NARROW = "(max-width: 639px)";

/** Phones: menus beside menus don't fit, so makers expand in place instead. */
function useNarrowScreen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(NARROW);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/** Models grouped by maker, in the order the server lists them. */
function groupByProvider(models: ModelSummary[]) {
  const groups = new Map<string, ModelSummary[]>();
  for (const model of models) {
    groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  }
  return [...groups].map(([id, list]) => ({ id, ...providerInfo(id), models: list }));
}

function Monogram({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "font-display flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
        active ? "bg-accent text-accent-ink" : "bg-ink/6 text-ink/80",
      )}
    >
      {name.charAt(0)}
    </span>
  );
}

function ModelRow({ model, selected }: { model: ModelSummary; selected: boolean }) {
  const reads = model.capabilities.includes("vision");
  const thinks = model.capabilities.includes("reasoning");
  return (
    <>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-medium">
          <span className="truncate">{model.label}</span>
          {model.tier === "pro" ? (
            <span className="border-line text-muted rounded border px-1 text-[0.6875rem] leading-4 font-normal">
              Pro
            </span>
          ) : null}
        </p>
        <p className="text-muted truncate text-xs">{model.description}</p>
      </div>
      <span className="text-muted/80 flex shrink-0 items-center gap-1">
        {thinks ? <Brain className="size-3.5" aria-label="Thinks before answering" /> : null}
        {reads ? <Eye className="size-3.5" aria-label="Reads images" /> : null}
      </span>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {selected ? <Check className="text-accent size-4" aria-label="Selected" /> : null}
      </span>
    </>
  );
}

/**
 * The model menu: model makers first; hover one (or press the right arrow) to
 * see its models. Below them, how hard a reasoning model should think.
 */
export function ModelPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (modelId: string) => void;
}) {
  const models = useModels();
  const effort = useChatPreferences((state) => state.effort);
  const setEffort = useChatPreferences((state) => state.setEffort);
  const list = models.data?.models ?? [];
  const selected =
    list.find((model) => model.id === value) ??
    list.find((m) => m.id === models.data?.defaultModel);
  const providers = groupByProvider(list);
  const thinks = selected?.capabilities.includes("reasoning") ?? false;
  const effortLabel = EFFORT_OPTIONS.find((option) => option.value === effort)?.label ?? "Medium";
  const narrow = useNarrowScreen();
  // On phones: which maker's models are showing. Starts on the selected model's maker.
  const [expanded, setExpanded] = useState<string | null>(null);
  const shownProvider = expanded ?? selected?.provider ?? null;

  return (
    <DropdownMenu onOpenChange={(open) => !open && setExpanded(null)}>
      <DropdownMenuTrigger
        aria-label={`Model: ${selected?.label ?? "loading"}`}
        disabled={!selected}
        className="text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent flex h-9 max-w-60 items-center gap-1.5 rounded-lg px-2.5 text-sm focus-visible:outline-2 disabled:opacity-50"
      >
        <span className="truncate">{selected?.label ?? "Model"}</span>
        {thinks ? (
          <span className="border-line text-muted hidden shrink-0 rounded-md border px-1.5 text-xs leading-5 sm:inline">
            {effortLabel}
          </span>
        ) : null}
        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className={cn(
          "max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto",
          narrow ? "w-[min(22rem,calc(100vw-1rem))]" : "w-64",
        )}
      >
        <p className="text-muted px-2.5 pt-1 pb-1.5 text-xs font-medium">Model</p>
        {narrow
          ? providers.map((provider) => {
              const open = provider.id === shownProvider;
              const current = provider.models.some((model) => model.id === selected?.id);
              return (
                <div key={provider.id}>
                  <DropdownMenuItem
                    aria-label={provider.name}
                    aria-expanded={open}
                    // Keeps the menu open: this shows or hides the maker's models.
                    onSelect={(event) => {
                      event.preventDefault();
                      setExpanded(open ? "" : provider.id);
                    }}
                    className="gap-2.5"
                  >
                    <Monogram name={provider.name} active={current} />
                    <span className="flex-1 font-medium">{provider.name}</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "text-muted size-4 transition-transform duration-200 motion-reduce:transition-none",
                        open && "rotate-180",
                      )}
                    />
                  </DropdownMenuItem>
                  {open
                    ? provider.models.map((model) => (
                        <DropdownMenuItem
                          key={model.id}
                          onSelect={() => onChange(model.id)}
                          className="gap-2.5 py-2 pl-11"
                        >
                          <ModelRow model={model} selected={model.id === selected?.id} />
                        </DropdownMenuItem>
                      ))
                    : null}
                </div>
              );
            })
          : null}
        {!narrow &&
          providers.map((provider) => {
            const current = provider.models.some((model) => model.id === selected?.id);
            return (
              <DropdownMenuSub key={provider.id}>
                <DropdownMenuSubTrigger className="gap-2.5" aria-label={provider.name}>
                  <Monogram name={provider.name} active={current} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{provider.name}</span>
                    {current ? (
                      <span className="text-muted block truncate text-xs">{selected?.label}</span>
                    ) : null}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-[min(30rem,75dvh)] w-80 overflow-y-auto">
                  <p className="text-muted px-2.5 pt-1 pb-1.5 text-xs font-medium">
                    {provider.maker === provider.name
                      ? provider.name
                      : `${provider.name} by ${provider.maker}`}
                  </p>
                  {provider.models.map((model) => (
                    <DropdownMenuItem
                      key={model.id}
                      onSelect={() => onChange(model.id)}
                      className="gap-2.5 py-2"
                    >
                      <ModelRow model={model} selected={model.id === selected?.id} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })}

        {thinks && narrow ? (
          <>
            <DropdownMenuSeparator />
            <p className="text-muted px-2.5 pt-1 pb-1.5 text-xs font-medium">Effort</p>
            <div className="grid grid-cols-3 gap-1 px-1 pb-1">
              {EFFORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={(event) => {
                    event.preventDefault();
                    setEffort(option.value);
                  }}
                  aria-checked={option.value === effort}
                  role="menuitemradio"
                  className={cn(
                    "justify-center border",
                    option.value === effort
                      ? "border-accent bg-accent/10 text-accent font-medium"
                      : "border-line",
                  )}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </div>
          </>
        ) : null}

        {thinks && !narrow ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2.5" aria-label={`Effort: ${effortLabel}`}>
                <Gauge className="text-muted size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">Effort</span>
                <span className="text-muted text-xs">{effortLabel}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-72">
                <p className="text-muted px-2.5 pt-1 pb-1.5 text-xs font-medium">
                  How hard {selected?.label} thinks
                </p>
                {EFFORT_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => setEffort(option.value)}
                    className="items-start gap-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{option.label}</p>
                      <p className="text-muted text-xs">{option.description}</p>
                    </div>
                    {option.value === effort ? (
                      <Check className="text-accent mt-0.5 size-4 shrink-0" aria-label="Selected" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
