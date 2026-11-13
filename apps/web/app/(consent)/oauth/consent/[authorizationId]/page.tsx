"use client";

import { toApiClientError } from "@tessel/api-client";
import { useApi, useWorkspaces } from "@tessel/api-client/react";
import type { OAuthAuthorization } from "@tessel/contracts";
import { Button, Spinner } from "@tessel/ui";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useId, useState } from "react";
import { FormError } from "@/components/form-error";
import { ScopeChoices } from "@/components/settings/scope-choices";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";

/**
 * An outside MCP client (Claude, Cursor, …) asks to use Tessel. The user picks
 * a workspace and allows or denies; the browser then returns to the client.
 */
export default function ConsentPage() {
  const { authorizationId } = useParams<{ authorizationId: string }>();
  const api = useApi();
  const workspaces = useWorkspaces();
  const { current } = useCurrentWorkspace();
  const selectId = useId();
  const request = useQuery<OAuthAuthorization>({
    queryKey: ["oauth", "authorizations", authorizationId],
    queryFn: () => api.oauth.describe(authorizationId),
    retry: false,
    staleTime: Infinity,
  });
  const [workspaceId, setWorkspaceId] = useState<string>();
  // Everything the client asked for, until the user unticks some of it.
  const [allowed, setAllowed] = useState<string[]>();
  const [busy, setBusy] = useState<"approve" | "deny">();
  const [error, setError] = useState<string>();
  const chosen = workspaceId ?? current?.id ?? workspaces.data?.[0]?.id;

  if (request.isPending || workspaces.isPending) return <Spinner label="Loading" />;
  if (request.isError) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">This request has expired</h1>
        <p className="text-muted mt-2">
          {toApiClientError(request.error).message} Go back to the app and connect Tessel again.
        </p>
      </>
    );
  }
  const { client, scopes, redirectHost } = request.data;
  const chosenScopes = allowed ?? scopes;

  async function decide(decision: "approve" | "deny") {
    setBusy(decision);
    setError(undefined);
    try {
      const redirectUrl =
        decision === "approve"
          ? await api.oauth.approve(authorizationId, chosen!, chosenScopes)
          : await api.oauth.deny(authorizationId);
      window.location.assign(redirectUrl);
    } catch (caught) {
      setError(toApiClientError(caught).message);
      setBusy(undefined);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Allow {client.name} to use Tessel?</h1>
      <p className="text-muted mt-2 text-sm">
        It will act as you in the workspace you choose. You can disconnect it any time in Settings.
      </p>

      <FormError message={error} />

      <div className="mt-6 flex flex-col gap-1.5">
        <label htmlFor={selectId} className="text-sm font-medium">
          Workspace
        </label>
        <select
          id={selectId}
          value={chosen}
          onChange={(event) => setWorkspaceId(event.target.value)}
          className="border-line bg-surface focus:border-accent focus:outline-accent/25 h-11 rounded-lg border px-3 text-base focus:outline-2"
        >
          {workspaces.data?.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6">
        <ScopeChoices
          legend="It will be able to"
          scopes={scopes}
          selected={chosenScopes}
          onChange={setAllowed}
        />
      </div>
      <p className="text-muted mt-2 text-sm">
        It can&apos;t change or delete anything that&apos;s already here.
      </p>

      <p className="text-muted mt-6 text-xs">
        Afterwards you&apos;ll go back to{" "}
        <span className="text-ink font-medium">{redirectHost}</span>
        {client.uri ? (
          <>
            {" "}
            (from{" "}
            <a href={client.uri} className="underline" rel="noreferrer noopener" target="_blank">
              {new URL(client.uri).host}
            </a>
            )
          </>
        ) : null}
        . Only allow apps you trust.
      </p>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="ghost"
          loading={busy === "deny"}
          disabled={Boolean(busy)}
          onClick={() => decide("deny")}
        >
          Deny
        </Button>
        <Button
          loading={busy === "approve"}
          disabled={Boolean(busy) || !chosen || chosenScopes.length === 0}
          onClick={() => decide("approve")}
        >
          Allow
        </Button>
      </div>
    </>
  );
}
