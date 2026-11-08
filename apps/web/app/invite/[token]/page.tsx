"use client";

import { toApiClientError } from "@tessel/api-client";
import { queryKeys, useApi } from "@tessel/api-client/react";
import { Button, Spinner, TesselMark } from "@tessel/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { useSessionStore } from "@/lib/session-store";
import { useWorkspaceStore } from "@/lib/workspace-store";

/**
 * Where an invitation email's link lands. Anyone can see what it's for; the
 * account it was sent to accepts it, signing in or up first if needed.
 */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);
  const setCurrentWorkspace = useWorkspaceStore((state) => state.setCurrentWorkspace);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string>();
  const preview = useQuery({
    queryKey: ["invitations", token],
    queryFn: () => api.invitations.preview(token),
    retry: false,
  });
  const next = encodeURIComponent(`/invite/${token}`);

  async function accept() {
    setAccepting(true);
    setError(undefined);
    try {
      const workspace = await api.invitations.accept(token);
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      setCurrentWorkspace(workspace.id);
      router.replace("/chat");
    } catch (caught) {
      setError(toApiClientError(caught).message);
      setAccepting(false);
    }
  }

  let body;
  if (preview.isPending || status === "loading") {
    body = <Spinner label="Loading invitation" />;
  } else if (preview.isError) {
    body = (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">This invitation has ended</h1>
        <p className="text-muted mt-2">{toApiClientError(preview.error).message}</p>
      </>
    );
  } else {
    const invitation = preview.data;
    const wrongAccount = user && user.email !== invitation.email;
    body = (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Join {invitation.workspaceName}</h1>
        <p className="text-muted mt-2">
          {invitation.inviterName ?? "Someone"} invited{" "}
          <span className="text-ink font-medium break-all">{invitation.email}</span> to join as{" "}
          {invitation.role === "admin" ? "an admin" : "a member"}.
        </p>
        <div className="mt-6">
          <FormError message={error} />
        </div>
        {status === "authenticated" ? (
          wrongAccount ? (
            <p className="mt-4 text-sm">
              You&apos;re signed in as <span className="font-medium">{user.email}</span>. Log out
              and sign in as {invitation.email} to accept.
            </p>
          ) : (
            <Button className="mt-4 w-full" loading={accepting} onClick={accept}>
              Join {invitation.workspaceName}
            </Button>
          )
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href={`/login?next=${next}`}
              className="bg-accent text-accent-ink hover:bg-accent-strong inline-flex h-11 items-center justify-center rounded-lg px-4 font-medium"
            >
              Log in to accept
            </Link>
            <Link
              href={`/signup?next=${next}`}
              className="border-line bg-surface hover:bg-paper inline-flex h-11 items-center justify-center rounded-lg border px-4 font-medium"
            >
              Create an account
            </Link>
            <p className="text-muted mt-1 text-xs">
              Use {invitation.email} so the invitation finds you.
            </p>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10 sm:py-16">
      <Link href="/" className="font-display flex items-center gap-2.5 text-lg font-semibold">
        <TesselMark />
        Tessel
      </Link>
      <main className="border-line bg-surface mt-8 w-full max-w-md rounded-xl border p-6 sm:p-8">
        {body}
      </main>
    </div>
  );
}
