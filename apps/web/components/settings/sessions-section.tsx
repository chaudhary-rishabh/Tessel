"use client";

import { useRevokeSession, useSessions } from "@tessel/api-client/react";
import type { Session } from "@tessel/contracts";
import { Button, Spinner } from "@tessel/ui";
import { Laptop, Smartphone } from "lucide-react";
import { toast } from "@/lib/toast-store";

/** "Chrome on macOS" from a user agent; good enough to recognise a device. */
export function describeDevice(userAgent: string | null): { label: string; mobile: boolean } {
  if (!userAgent) return { label: "Unknown device", mobile: false };
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  const system = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  const mobile = /Mobile|iPhone|Android/.test(userAgent);
  if (!browser && !system) return { label: userAgent.slice(0, 60), mobile };
  return {
    label: [browser ?? "Browser", system && `on ${system}`].filter(Boolean).join(" "),
    mobile,
  };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function SessionRow({ session, onRevoke }: { session: Session; onRevoke: () => void }) {
  const device = describeDevice(session.userAgent);
  const Icon = device.mobile ? Smartphone : Laptop;
  return (
    <li className="flex items-start gap-3 py-3.5">
      <Icon className="text-muted mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          {device.label}
          {session.current ? <span className="text-accent ml-2 text-xs">This device</span> : null}
        </p>
        <p className="text-muted mt-0.5 text-xs">
          Active {when(session.lastUsedAt)}
          {session.ipAddress ? ` from ${session.ipAddress}` : ""}. Signed in{" "}
          {when(session.createdAt)}.
        </p>
      </div>
      {session.current ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          onClick={onRevoke}
          aria-label={`Log out ${device.label}`}
        >
          Log out
        </Button>
      )}
    </li>
  );
}

/** Where the user is signed in, with a way to end any other session. */
export function SessionsSection() {
  const sessions = useSessions();
  const revoke = useRevokeSession();

  if (sessions.isPending) return <Spinner label="Loading sessions" />;
  if (sessions.isError) {
    return <p className="text-danger text-sm">Sessions couldn&apos;t be loaded.</p>;
  }
  return (
    <ul className="divide-line border-line divide-y border-y" aria-label="Signed-in devices">
      {sessions.data.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          onRevoke={() =>
            revoke.mutate(session.id, {
              onError: (error) => toast.error(error.message),
            })
          }
        />
      ))}
    </ul>
  );
}
