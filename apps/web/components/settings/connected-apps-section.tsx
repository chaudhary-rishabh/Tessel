"use client";

import { useConnectedApps, useDisconnectApp } from "@tessel/api-client/react";
import { Button, Spinner } from "@tessel/ui";
import { AppWindow } from "lucide-react";

const formatDate = (iso: string | null, fallback: string) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : fallback;

/** MCP clients the user signed in to Tessel with OAuth, each with a way to disconnect it. */
export function ConnectedAppsSection() {
  const apps = useConnectedApps();
  const disconnect = useDisconnectApp();

  if (apps.isPending) return <Spinner label="Loading connected apps" />;
  if (apps.isError)
    return <p className="text-danger text-sm">Connected apps couldn&apos;t be loaded.</p>;
  if (apps.data.length === 0) {
    return (
      <p className="text-muted text-sm">
        None yet. Add Tessel&apos;s MCP server in an app like Claude or Cursor and sign in when it
        asks.
      </p>
    );
  }
  return (
    <ul className="divide-line border-line divide-y border-y" aria-label="Connected apps">
      {apps.data.map((app) => (
        <li key={app.id} className="flex items-start gap-3 py-3.5">
          <AppWindow className="text-muted mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">{app.name}</p>
            <p className="text-muted mt-0.5 text-xs">
              In {app.workspace.name}. Connected {formatDate(app.createdAt, "")}, last used{" "}
              {formatDate(app.lastUsedAt, "not yet")}.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            aria-label={`Disconnect ${app.name}`}
            onClick={() => disconnect.mutate(app.id)}
          >
            Disconnect
          </Button>
        </li>
      ))}
    </ul>
  );
}
