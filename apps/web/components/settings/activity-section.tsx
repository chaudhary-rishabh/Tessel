"use client";

import { useAuditLog } from "@tessel/api-client/react";
import type { AuditEvent } from "@tessel/contracts";
import { Button, Spinner } from "@tessel/ui";

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** One plain sentence per audit event. Unknown actions fall back to their name. */
export function describeEvent(event: AuditEvent): string {
  const who = event.actor?.name ?? "Someone";
  const data = event.metadata;
  switch (event.action) {
    case "workspace.created":
      return `${who} created the workspace`;
    case "workspace.renamed":
      return `${who} renamed the workspace to ${text(data.to)}`;
    case "workspace.ownership_transferred":
      return `${who} handed ownership to another member`;
    case "member.invited":
      return `${who} invited ${text(data.email)} as ${text(data.role) === "admin" ? "an admin" : "a member"}`;
    case "member.invitation_revoked":
      return `${who} revoked the invitation for ${text(data.email)}`;
    case "member.joined":
      return `${who} joined`;
    case "member.role_changed":
      return `${who} changed a member from ${text(data.from)} to ${text(data.to)}`;
    case "member.removed":
      return `${who} removed a member`;
    case "member.left":
      return `${who} left`;
    case "token.created":
      return `${who} created the access token "${text(data.name)}"`;
    case "token.revoked":
      return `${who} revoked an access token`;
    case "app.connected":
      return `${who} connected ${text(data.name) || "an app"}`;
    case "app.disconnected":
      return `${who} disconnected an app`;
    case "connector.added":
      return `${who} connected ${text(data.name) || "a connector"}`;
    case "connector.removed":
      return `${who} removed a connector`;
    case "document.deleted":
      return `${who} deleted ${text(data.filename) || "a document"}`;
    default:
      return `${who}: ${event.action}`;
  }
}

/** The workspace's audit log, for its owners and admins. */
export function ActivitySection({ workspaceId }: { workspaceId: string }) {
  const log = useAuditLog(workspaceId);
  if (log.isPending) return <Spinner label="Loading activity" />;
  if (log.isError) return <p className="text-danger text-sm">Activity couldn&apos;t be loaded.</p>;
  const events = log.data.pages.flatMap((page) => page.events);
  if (events.length === 0) return <p className="text-muted text-sm">Nothing yet.</p>;

  return (
    <div className="flex flex-col gap-3">
      <ol className="divide-line border-line divide-y border-y" aria-label="Activity">
        {events.map((event) => (
          <li key={event.id} className="py-3 text-sm">
            <p>{describeEvent(event)}</p>
            <p className="text-muted mt-0.5 text-xs">
              <time dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
              {event.ipAddress ? `, from ${event.ipAddress}` : ""}
            </p>
          </li>
        ))}
      </ol>
      {log.hasNextPage ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          loading={log.isFetchingNextPage}
          onClick={() => log.fetchNextPage()}
        >
          Show older
        </Button>
      ) : null}
    </div>
  );
}
