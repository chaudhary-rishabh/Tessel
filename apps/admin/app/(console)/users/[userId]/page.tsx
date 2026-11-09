"use client";

import { toApiClientError } from "@tessel/api-client";
import { useApi } from "@tessel/api-client/react";
import type { AdminUserDetail } from "@tessel/contracts";
import { Button, Dialog, DialogClose, DialogContent, Spinner } from "@tessel/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AuditList } from "@/components/audit-list";
import { ErrorText, PageHeader } from "@/components/page-header";
import { dateTime, dollars } from "@/lib/format";
import { useSessionStore } from "@/lib/session-store";

type Action = "suspend" | "unsuspend" | "make-admin" | "remove-admin" | "sign-out";

const CONFIRM: Record<
  Action,
  { title: string; description: string; label: string; danger: boolean }
> = {
  suspend: {
    title: "Suspend this account?",
    description:
      "They're signed out everywhere and can't sign in. Their access tokens and connected apps stop working. Their workspaces and documents stay.",
    label: "Suspend",
    danger: true,
  },
  unsuspend: {
    title: "Lift the suspension?",
    description: "They can sign in again, and their tokens work again.",
    label: "Lift suspension",
    danger: false,
  },
  "make-admin": {
    title: "Make this person an admin?",
    description: "They'll see everyone's accounts, change models, and suspend people.",
    label: "Make admin",
    danger: false,
  },
  "remove-admin": {
    title: "Remove admin access?",
    description: "They lose access to the admin app straight away.",
    label: "Remove admin",
    danger: true,
  },
  "sign-out": {
    title: "Sign them out everywhere?",
    description: "Every browser and device has to sign in again.",
    label: "Sign out everywhere",
    danger: true,
  },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[12rem_1fr]">
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

export default function UserPage() {
  const { userId } = useParams<{ userId: string }>();
  const api = useApi();
  const queryClient = useQueryClient();
  const me = useSessionStore((state) => state.user);
  const [confirming, setConfirming] = useState<Action>();
  const user = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => api.admin.user(userId),
  });
  const events = useQuery({
    queryKey: ["admin", "audit", "actor", userId],
    queryFn: () => api.admin.auditLog({ actorId: userId, limit: 20 }),
  });
  const act = useMutation({
    mutationFn: async (action: Action): Promise<AdminUserDetail | undefined> => {
      if (action === "sign-out") {
        await api.admin.signOutUser(userId);
        return undefined;
      }
      return api.admin.updateUser(
        userId,
        action === "suspend" || action === "unsuspend"
          ? { suspended: action === "suspend" }
          : { role: action === "make-admin" ? "admin" : "user" },
      );
    },
    onSuccess: async (updated) => {
      if (updated) queryClient.setQueryData(["admin", "user", userId], updated);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      setConfirming(undefined);
    },
  });

  if (user.isPending) return <Spinner label="Loading" />;
  if (user.isError) return <ErrorText>{toApiClientError(user.error).message}</ErrorText>;
  const data = user.data;
  const isMe = data.id === me?.id;
  const confirm = confirming ? CONFIRM[confirming] : undefined;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/users" className="text-muted text-sm hover:underline">
        Users
      </Link>
      <PageHeader title={data.name} description={data.email} />

      {isMe ? (
        <p className="text-muted mt-6 text-sm">
          This is you. Another admin can change your account.
        </p>
      ) : (
        <div className="mt-6 flex flex-wrap gap-2">
          {data.suspended ? (
            <Button onClick={() => setConfirming("unsuspend")}>Lift suspension</Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirming("suspend")}>
              Suspend
            </Button>
          )}
          <Button variant="secondary" onClick={() => setConfirming("sign-out")}>
            Sign out everywhere
          </Button>
          {data.role === "admin" ? (
            <Button variant="ghost" onClick={() => setConfirming("remove-admin")}>
              Remove admin
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming("make-admin")}>
              Make admin
            </Button>
          )}
        </div>
      )}

      <section aria-labelledby="account-heading" className="mt-8">
        <h2 id="account-heading" className="text-lg font-semibold">
          Account
        </h2>
        <dl className="divide-line border-line mt-2 divide-y border-y">
          <Row label="Status">{data.suspended ? "Suspended" : "Active"}</Row>
          <Row label="Role">{data.role === "admin" ? "Admin" : "User"}</Row>
          <Row label="Joined">{dateTime(data.createdAt)}</Row>
          <Row label="Last signed in">{dateTime(data.lastLoginAt)}</Row>
          <Row label="Ways to sign in">
            {[
              data.hasPassword ? "Password" : null,
              ...data.identities.map((provider) => (provider === "google" ? "Google" : "GitHub")),
              data.phone ? `Phone (${data.phone})` : null,
            ]
              .filter(Boolean)
              .join(", ") || "None"}
          </Row>
          <Row label="Two-step sign-in">{data.twoFactorEnabled ? "On" : "Off"}</Row>
          <Row label="Email verified">{data.emailVerified ? "Yes" : "No"}</Row>
          <Row label="Signed-in devices">{data.activeSessions}</Row>
          <Row label="AI spend, 30 days">{dollars(data.cost30dNanoUsd)}</Row>
        </dl>
      </section>

      <section aria-labelledby="workspaces-heading" className="mt-8">
        <h2 id="workspaces-heading" className="text-lg font-semibold">
          Workspaces
        </h2>
        <ul className="divide-line border-line mt-2 divide-y border-y" aria-label="Workspaces">
          {data.workspaces.map((workspace) => (
            <li key={workspace.id} className="flex justify-between gap-3 py-2.5 text-sm">
              <span className="font-medium">{workspace.name}</span>
              <span className="text-muted">
                {workspace.role}
                {workspace.isPersonal ? ", personal" : `, ${workspace.memberCount} members`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="activity-heading" className="mt-8">
        <h2 id="activity-heading" className="text-lg font-semibold">
          Recent activity
        </h2>
        <div className="mt-3">
          {events.data ? <AuditList events={events.data.events} label="Recent activity" /> : null}
        </div>
      </section>

      {confirm ? (
        <Dialog open onOpenChange={(open) => !open && setConfirming(undefined)}>
          <DialogContent
            title={confirm.title}
            description={confirm.description}
            className="max-w-md"
          >
            {act.error ? (
              <div className="mt-4">
                <ErrorText>{toApiClientError(act.error).message}</ErrorText>
              </div>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                variant={confirm.danger ? "danger" : "primary"}
                loading={act.isPending}
                onClick={() => act.mutate(confirming!)}
              >
                {confirm.label}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
