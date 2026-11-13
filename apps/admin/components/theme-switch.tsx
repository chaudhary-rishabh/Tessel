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
export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>(() =>
    typeof window === "undefined" ? "system" : readTheme(),
  );
  return (
    <fieldset className="px-2">
      <legend className="text-muted mb-1.5 text-xs">Theme</legend>
      <div className="bg-paper inline-flex rounded-lg p-0.5">
        {CHOICES.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            title={label}
            className={cn(
              "flex size-8 cursor-pointer items-center justify-center rounded-md",
              "has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-2",
              choice === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <input
              type="radio"
              name="admin-theme"
              value={value}
              checked={choice === value}
              onChange={() => {
                setChoice(value);
                applyTheme(value);
              }}
              aria-label={label}
              className="sr-only"
            />
            <Icon className="size-4" aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
