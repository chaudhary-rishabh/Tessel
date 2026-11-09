"use client";

import type { AuditEvent } from "@tessel/contracts";
import { describeAction, describeDetails } from "@/lib/audit";
import { dateTime } from "@/lib/format";

export function AuditList({
  events,
  label = "Audit events",
}: {
  events: AuditEvent[];
  label?: string;
}) {
  if (events.length === 0) return <p className="text-muted text-sm">Nothing recorded.</p>;
  return (
    <ol
      className="divide-line border-line bg-surface divide-y rounded-xl border"
      aria-label={label}
    >
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:gap-4">
          <time dateTime={event.createdAt} className="figures text-muted w-44 shrink-0">
            {dateTime(event.createdAt)}
          </time>
          <div className="min-w-0 flex-1">
            <p>
              <span className="font-medium">{event.actor?.name ?? "System"}</span>{" "}
              <span className="text-muted">{event.actor?.email}</span>
            </p>
            <p>{describeAction(event.action)}</p>
            <p className="text-muted text-xs break-all">
              {describeDetails(event)}
              {event.ipAddress ? ` · from ${event.ipAddress}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
