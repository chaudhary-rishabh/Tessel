"use client";

import { cn } from "@tessel/ui";
import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { applyTheme, readTheme, type ThemeChoice } from "@/lib/theme";

const CHOICES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Match my device", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Light, dark, or the device's setting, remembered in this browser. */
export function AppearanceSection() {
  const [choice, setChoice] = useState<ThemeChoice>(() =>
    typeof window === "undefined" ? "system" : readTheme(),
  );
  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {CHOICES.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "border-line hover:bg-ink/4 relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm",
              "has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-2",
              choice === value && "border-accent ring-accent/20 font-medium ring-2",
            )}
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={choice === value}
              onChange={() => {
                setChoice(value);
                applyTheme(value);
              }}
              className="sr-only"
            />
            <Icon className="text-muted size-4" aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
