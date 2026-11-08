"use client";

import {
  useAccessTokens,
  useCreateAccessToken,
  useRevokeAccessToken,
} from "@tessel/api-client/react";
import type { AccessToken, CreateAccessTokenResponse } from "@tessel/contracts";
import { Button, cn, Dialog, DialogClose, DialogContent, Spinner, TextField } from "@tessel/ui";
import { KeyRound, Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { CopyButton } from "@/components/chat/markdown";
import { FormError } from "@/components/form-error";
import { env } from "@/lib/env";

const EXPIRY = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "No expiry" },
] as const;

const formatDate = (iso: string | null, fallback: string) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : fallback;

function clientConfig(token: string) {
  return JSON.stringify(
    { mcpServers: { tessel: { url: env.mcpUrl, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}

/** Creates a token and shows it once, with the settings an MCP client needs. */
function CreateTokenDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const create = useCreateAccessToken(workspaceId);
  const expiryId = useId();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]["value"]>("90");
  const [created, setCreated] = useState<CreateAccessTokenResponse>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await create.mutateAsync({
      name,
      expiresInDays: expiry === "never" ? null : (Number(expiry) as 7 | 30 | 90 | 365),
    });
    setCreated(result);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={created ? "Copy your token" : "New access token"}
        description={
          created
            ? "This is the only time it's shown. Store it somewhere safe, like your MCP client's settings."
            : "Lets an outside tool, such as Claude Desktop or Cursor, search and read this workspace's documents as you."
        }
        className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto"
      >
        {created ? (
          <div className="mt-5 flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium">Token</p>
              <div className="bg-paper mt-1.5 flex items-center gap-2 rounded-lg px-3 py-2">
                <code
                  className="min-w-0 flex-1 font-mono text-sm break-all"
                  data-testid="new-token"
                >
                  {created.token}
                </code>
                <CopyButton text={created.token} label="Copy token" />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium">MCP client settings</p>
              <p className="text-muted mt-0.5 text-xs">
                For clients that take a server URL and headers.
              </p>
              <div className="bg-paper relative mt-1.5 rounded-lg">
                <pre className="overflow-x-auto p-3 pr-12 font-mono text-xs leading-relaxed">
                  {clientConfig(created.token)}
                </pre>
                <div className="absolute top-1.5 right-1.5">
                  <CopyButton text={clientConfig(created.token)} label="Copy settings" />
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            <FormError message={create.error?.message} />
            <TextField
              label="Name"
              placeholder="Claude Desktop on my laptop"
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={60}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={expiryId} className="text-sm font-medium">
                Expires after
              </label>
              <select
                id={expiryId}
                value={expiry}
                onChange={(event) => setExpiry(event.target.value as typeof expiry)}
                className="border-line bg-surface focus:border-accent focus:outline-accent/25 h-11 rounded-lg border px-3 text-base focus:outline-2"
              >
                {EXPIRY.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-muted text-sm">
              It can search and read documents. It can&apos;t chat, change, or delete anything.
            </p>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
                Create token
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TokenRow({ token, onRevoke }: { token: AccessToken; onRevoke: () => void }) {
  return (
    <li className="flex items-start gap-3 py-3.5">
      <KeyRound className="text-muted mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{token.name}</p>
        <p className="text-muted font-mono text-xs">{token.prefix}…</p>
        <p className="text-muted mt-0.5 text-xs">
          Last used {formatDate(token.lastUsedAt, "never")}. Expires{" "}
          {formatDate(token.expiresAt, "never")}.
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-danger"
        onClick={onRevoke}
        aria-label={`Revoke ${token.name}`}
      >
        Revoke
      </Button>
    </li>
  );
}

/** Personal access tokens for the Tessel MCP server, in Settings. */
export function AccessTokensSection({ workspaceId }: { workspaceId: string }) {
  const tokens = useAccessTokens(workspaceId);
  const revoke = useRevokeAccessToken(workspaceId);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<AccessToken>();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        MCP server:{" "}
        <code className="bg-paper rounded px-1.5 py-0.5 font-mono text-xs break-all">
          {env.mcpUrl}
        </code>
      </p>
      {tokens.isPending ? (
        <Spinner label="Loading tokens" />
      ) : tokens.isError ? (
        <p className="text-danger text-sm">Tokens couldn&apos;t be loaded.</p>
      ) : tokens.data.length === 0 ? (
        <p className="text-muted text-sm">No tokens yet.</p>
      ) : (
        <ul className="divide-line border-line divide-y border-y" aria-label="Access tokens">
          {tokens.data.map((token) => (
            <TokenRow key={token.id} token={token} onRevoke={() => setRevoking(token)} />
          ))}
        </ul>
      )}
      <div>
        <Button variant="secondary" size="sm" className="gap-2" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New token
        </Button>
      </div>
      {creating ? (
        <CreateTokenDialog workspaceId={workspaceId} onClose={() => setCreating(false)} />
      ) : null}
      {revoking ? (
        <Dialog open onOpenChange={(open) => !open && setRevoking(undefined)}>
          <DialogContent
            title={`Revoke ${revoking.name}?`}
            description="Anything using this token stops working right away."
          >
            <FormError message={revoke.error?.message} />
            <div className={cn("flex justify-end gap-2", revoke.error ? "mt-4" : "mt-6")}>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                loading={revoke.isPending}
                onClick={() =>
                  revoke.mutate(revoking.id, { onSuccess: () => setRevoking(undefined) })
                }
              >
                Revoke token
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
