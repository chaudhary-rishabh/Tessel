"use client";

import { useConnectors, usePolicies, useUpdatePolicies } from "@tessel/api-client/react";
import type { WorkspaceToolPolicy } from "@tessel/contracts";
import { Spinner } from "@tessel/ui";
import { FormError } from "@/components/form-error";

const CHOICES: { value: "default" | WorkspaceToolPolicy; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "ask", label: "Always ask first" },
  { value: "allow", label: "Don't ask" },
  { value: "block", label: "Off" },
];

/**
 * Workspace-wide rules for the agent's tools and connectors. Everyone can
 * see them; owners and admins change them.
 */
export function PoliciesSection({ workspaceId }: { workspaceId: string }) {
  const policies = usePolicies(workspaceId);
  const connectors = useConnectors(workspaceId);
  const update = useUpdatePolicies(workspaceId);
  if (!policies.data) return <Spinner label="Loading policies" />;
  const { tools, toolPolicies, blockedConnectors, canEdit } = policies.data;
  const catalog = connectors.data?.catalog ?? [];

  return (
    <div className="flex flex-col gap-6">
      {!canEdit ? (
        <p className="text-muted text-sm">Only owners and admins can change these.</p>
      ) : null}
      <div>
        <h3 className="font-medium">Tools</h3>
        <p className="text-muted text-sm">
          Default asks before tools that change things. These choices apply to everyone.
        </p>
        <ul className="divide-line border-line mt-2 divide-y border-y" aria-label="Tool policies">
          {tools.map((tool) => (
            <li key={tool.name} className="flex items-center gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{tool.title}</p>
                <p className="text-muted text-xs">
                  {tool.asksByDefault ? "Asks first by default" : "Runs without asking by default"}
                </p>
              </div>
              <label className="sr-only" htmlFor={`policy-${tool.name}`}>
                {`Policy for ${tool.title}`}
              </label>
              <select
                id={`policy-${tool.name}`}
                value={toolPolicies[tool.name] ?? "default"}
                disabled={!canEdit || update.isPending}
                onChange={(event) => {
                  const next = { ...toolPolicies };
                  if (event.target.value === "default") delete next[tool.name];
                  else next[tool.name] = event.target.value as WorkspaceToolPolicy;
                  update.mutate({ toolPolicies: next });
                }}
                className="border-line bg-surface h-9 rounded-lg border px-2 text-sm disabled:opacity-60"
              >
                {CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </div>
      {catalog.length > 0 ? (
        <div>
          <h3 className="font-medium">Connectors</h3>
          <p className="text-muted text-sm">
            A blocked app can't be connected, and existing connections to it stop working.
          </p>
          <ul
            className="divide-line border-line mt-2 divide-y border-y"
            aria-label="Connector policies"
          >
            {catalog.map((entry) => {
              const blocked = blockedConnectors.includes(entry.id);
              return (
                <li key={entry.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <p className="min-w-0 flex-1 font-medium">{entry.name}</p>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={blocked}
                      disabled={!canEdit || update.isPending}
                      onChange={(event) =>
                        update.mutate({
                          blockedConnectors: event.target.checked
                            ? [...blockedConnectors, entry.id]
                            : blockedConnectors.filter((id) => id !== entry.id),
                        })
                      }
                      className="accent-accent size-4"
                      aria-label={`Block ${entry.name}`}
                    />
                    Block
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <FormError message={update.error?.message} />
    </div>
  );
}
