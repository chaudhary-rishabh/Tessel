"use client";

import { ACCESS_TOKEN_SCOPE_TEXT, type AccessTokenScope } from "@tessel/contracts";
import { useId } from "react";

const SHORT: Record<AccessTokenScope, string> = {
  "documents:read": "read documents",
  "documents:write": "add documents",
  "chat:write": "ask questions",
};

const isKnown = (scope: string): scope is AccessTokenScope => Object.hasOwn(SHORT, scope);

/** "Can read documents and ask questions." for a token or app's row. */
export function scopeSummary(scopes: readonly string[]): string {
  const words = scopes.filter(isKnown).map((scope) => SHORT[scope]);
  if (words.length === 0) return "Can't do anything yet.";
  const list =
    words.length === 1
      ? words[0]
      : `${words.slice(0, -1).join(", ")}${words.length > 2 ? "," : ""} and ${words.at(-1)}`;
  return `Can ${list}.`;
}

/** Checkboxes for what an outside tool may do. */
export function ScopeChoices({
  scopes,
  selected,
  onChange,
  legend = "It can",
}: {
  scopes: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  legend?: string;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {scopes.map((scope) => {
        const inputId = `${id}-${scope}`;
        const checked = selected.includes(scope);
        return (
          <label key={scope} htmlFor={inputId} className="flex items-start gap-3 text-sm">
            <input
              id={inputId}
              type="checkbox"
              checked={checked}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? scopes.filter((item) => item === scope || selected.includes(item))
                    : selected.filter((item) => item !== scope),
                )
              }
              className="accent-accent mt-0.5 size-4"
            />
            <span>{isKnown(scope) ? ACCESS_TOKEN_SCOPE_TEXT[scope] : scope}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
