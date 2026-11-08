"use client";

import { useCreateConnection } from "@tessel/api-client/react";
import type { ConnectorCatalogEntry, CreateConnectionRequest } from "@tessel/contracts";
import { Button, Dialog, DialogClose, DialogContent, TextField } from "@tessel/ui";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";

type AuthChoice = "none" | "token" | "oauth";

const AUTH_OPTIONS: { value: AuthChoice; label: string; hint: string }[] = [
  { value: "oauth", label: "Sign in with OAuth", hint: "You'll sign in on the app's own page." },
  { value: "token", label: "Access token", hint: "Paste a token the app gave you." },
  { value: "none", label: "No sign-in", hint: "For servers that are open to anyone." },
];

/**
 * Connects an app from the catalog (asking for a token if it needs one) or a
 * custom MCP server. OAuth sends the browser to the app's sign-in page.
 */
export function ConnectDialog({
  workspaceId,
  entry,
  onClose,
}: {
  workspaceId: string;
  /** A catalog app, or undefined for a custom server. */
  entry?: ConnectorCatalogEntry;
  onClose: () => void;
}) {
  const create = useCreateConnection(workspaceId);
  const [name, setName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [auth, setAuth] = useState<AuthChoice>("oauth");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();
  const needsToken = entry ? entry.auth === "token" : auth === "token";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const input: CreateConnectionRequest = entry
      ? { catalogId: entry.id, ...(needsToken ? { token } : {}) }
      : { name, serverUrl, auth, ...(needsToken ? { token } : {}) };
    try {
      const result = await create.mutateAsync(input);
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Tessel couldn't connect");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={entry ? `Connect ${entry.name}` : "Add a custom connector"}
        description={
          entry
            ? entry.description
            : "Connect any remote MCP server. Tessel uses it only as you, and asks before changing anything."
        }
        className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto"
      >
        <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
          <FormError message={error} />
          {entry ? null : (
            <>
              <TextField
                label="Name"
                placeholder="Issue tracker"
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
              <TextField
                label="Server URL"
                type="url"
                placeholder="https://example.com/mcp"
                autoComplete="off"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                required
              />
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">How to sign in</legend>
                {AUTH_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="border-line has-[:checked]:border-accent has-[:checked]:bg-accent/5 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5"
                  >
                    <input
                      type="radio"
                      name="auth"
                      value={option.value}
                      checked={auth === option.value}
                      onChange={() => setAuth(option.value)}
                      className="accent-accent mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="text-muted block text-xs">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {needsToken ? (
            <TextField
              label="Access token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              hint={entry?.tokenHelp ?? "Stored encrypted and used only for your requests."}
              required
            />
          ) : null}
          {entry && entry.auth === "oauth" ? (
            <p className="text-muted text-sm">
              You&apos;ll sign in on {entry.name}&apos;s page, then come back here.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              {needsToken || (!entry && auth === "none") ? "Connect" : "Continue to sign in"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
