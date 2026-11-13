"use client";

import { toApiClientError } from "@tessel/api-client";

import {
  useConnectors,
  useDeleteConnection,
  useRefreshConnection,
  useUpdateConnection,
} from "@tessel/api-client/react";
import type {
  ConnectorCatalogEntry,
  ConnectorConnection,
  ConnectorTool,
  ToolPolicyName,
} from "@tessel/contracts";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
} from "@tessel/ui";
import { ChevronRight, Ellipsis, Plug, Plus, RotateCw, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ConnectDialog } from "@/components/connectors/connect-dialog";
import { FormError } from "@/components/form-error";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { toast } from "@/lib/toast-store";

const STATUS: Record<ConnectorConnection["status"], { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "text-accent" },
  pending: { label: "Waiting for sign-in", tone: "text-muted" },
  needs_auth: { label: "Sign in again", tone: "text-danger" },
  error: { label: "Couldn't connect", tone: "text-danger" },
};

const CALLBACK_ERRORS: Record<string, string> = {
  denied: "The sign-in was cancelled.",
  expired: "That sign-in link expired. Try connecting again.",
  failed: "The sign-in didn't finish. Try connecting again.",
  invalid: "That sign-in link isn't valid.",
};

function policyLabel(tool: ConnectorTool, policy: ToolPolicyName) {
  if (policy === "auto") return tool.readOnly ? "Allow (read-only)" : "Ask first";
  return { ask: "Ask first", allow: "Always allow", off: "Off" }[policy];
}

function ToolSettings({
  workspaceId,
  connection,
}: {
  workspaceId: string;
  connection: ConnectorConnection;
}) {
  const update = useUpdateConnection(workspaceId);
  const [open, setOpen] = useState(false);
  if (connection.tools.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-accent focus-visible:outline-accent inline-flex items-center gap-1 rounded text-sm font-medium hover:underline focus-visible:outline-2"
      >
        <ChevronRight
          className={cn(
            "size-4 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden
        />
        {connection.tools.length} tool{connection.tools.length === 1 ? "" : "s"}
      </button>
      {open ? (
        <ul className="divide-line mt-2 divide-y" aria-label={`${connection.name} tools`}>
          {connection.tools.map((tool) => (
            <li
              key={tool.name}
              className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{tool.title}</p>
                {tool.description ? <p className="text-muted text-xs">{tool.description}</p> : null}
              </div>
              <label className="sr-only" htmlFor={`${connection.id}-${tool.name}`}>
                {`Approval for ${tool.title}`}
              </label>
              <select
                id={`${connection.id}-${tool.name}`}
                value={tool.policy}
                onChange={(event) =>
                  update.mutate({
                    connectionId: connection.id,
                    input: { toolPolicies: { [tool.name]: event.target.value as ToolPolicyName } },
                  })
                }
                className="border-line bg-surface focus:border-accent focus:outline-accent/25 h-10 rounded-lg border px-2 text-sm focus:outline-2"
              >
                {(["auto", "ask", "allow", "off"] as const).map((policy) => (
                  <option key={policy} value={policy}>
                    {policy === "auto"
                      ? `Default: ${policyLabel(tool, "auto")}`
                      : policyLabel(tool, policy)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ConnectionRow({
  workspaceId,
  connection,
  onDisconnect,
}: {
  workspaceId: string;
  connection: ConnectorConnection;
  onDisconnect: () => void;
}) {
  const update = useUpdateConnection(workspaceId);
  const refresh = useRefreshConnection(workspaceId);
  const on = update.isPending ? !connection.enabled : connection.enabled;
  const status = STATUS[connection.status];
  const host = (() => {
    try {
      return new URL(connection.serverUrl).host;
    } catch {
      return connection.serverUrl;
    }
  })();

  async function checkAgain() {
    try {
      const result = await refresh.mutateAsync(connection.id);
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast.error(toApiClientError(error).message);
    }
  }

  return (
    <li className="py-4">
      <div className="flex items-start gap-3">
        <div className="bg-paper text-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Plug className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {connection.name}
            {connection.shared ? (
              <span className="bg-accent/10 text-ink ml-2 rounded-full px-2 py-0.5 align-middle text-xs font-normal">
                {connection.mine ? "Shared with everyone" : "Shared by your admins"}
              </span>
            ) : null}
          </p>
          <p className="text-muted truncate text-xs">{host}</p>
          <p className={cn("mt-0.5 text-sm", status.tone)}>
            {refresh.isPending ? "Checking…" : status.label}
            {connection.lastError && connection.status !== "connected" ? (
              <span className="text-muted"> {connection.lastError}</span>
            ) : null}
          </p>
        </div>
        {connection.mine ? (
          <>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={`Use ${connection.name}`}
              disabled={update.isPending || connection.status !== "connected"}
              onClick={() =>
                update.mutate({
                  connectionId: connection.id,
                  input: { enabled: !connection.enabled },
                })
              }
              className={cn(
                "focus-visible:outline-accent relative mt-2 h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 motion-reduce:transition-none",
                on ? "bg-accent" : "bg-line",
              )}
            >
              <span
                className={cn(
                  "bg-surface absolute top-0.5 left-0.5 size-5 rounded-full shadow transition-transform motion-reduce:transition-none",
                  on && "translate-x-4",
                )}
              />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Options for ${connection.name}`}
                className="text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent flex size-10 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2"
              >
                <Ellipsis className="size-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onSelect={() => void checkAgain()}>
                  <RotateCw className="size-4" aria-hidden="true" />
                  {connection.status === "connected" ? "Check again" : "Reconnect"}
                </DropdownMenuItem>
                <DropdownMenuItem className="text-danger" onSelect={onDisconnect}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>
      {connection.mine ? (
        <div className="pl-13">
          <ToolSettings workspaceId={workspaceId} connection={connection} />
        </div>
      ) : null}
    </li>
  );
}

function CallbackNotice({ connections }: { connections: ConnectorConnection[] }) {
  const params = useSearchParams();
  const connected = connections.find((item) => item.id === params.get("connected"));
  const error = params.get("error");
  if (connected) {
    return (
      <p
        role="status"
        className="border-accent/30 bg-accent/8 text-accent mt-6 rounded-lg border px-3.5 py-3 text-sm"
      >
        {connected.name} is connected. Tessel can use its tools in chat.
      </p>
    );
  }
  if (error)
    return (
      <div className="mt-6">
        <FormError message={CALLBACK_ERRORS[error] ?? CALLBACK_ERRORS.failed} />
      </div>
    );
  return null;
}

export default function ConnectorsPage() {
  const { current } = useCurrentWorkspace();
  const connectors = useConnectors(current?.id);
  const remove = useDeleteConnection(current?.id ?? "");
  const [connecting, setConnecting] = useState<ConnectorCatalogEntry | "custom">();
  const [disconnecting, setDisconnecting] = useState<ConnectorConnection>();
  if (!current) return null;

  const connections = connectors.data?.connections ?? [];
  const connectedIds = new Set(connections.map((item) => item.catalogId).filter(Boolean));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 md:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Connectors</h1>
      <p className="text-muted mt-2 max-w-prose">
        Connect the apps you work in. Tessel uses them only as you, in your chats, and asks before
        changing anything unless you allow a tool.
      </p>
      <Suspense>
        <CallbackNotice connections={connections} />
      </Suspense>

      {connectors.isPending ? (
        <div className="mt-10">
          <Spinner label="Loading connectors" />
        </div>
      ) : connectors.isError ? (
        <p className="text-danger mt-10 text-sm">
          Connectors couldn&apos;t be loaded. Refresh to try again.
        </p>
      ) : (
        <>
          <section aria-labelledby="your-connectors" className="mt-10">
            <h2 id="your-connectors" className="text-lg font-semibold">
              Your connectors
            </h2>
            {connections.length === 0 ? (
              <p className="text-muted mt-3 text-sm">Nothing connected yet. Pick an app below.</p>
            ) : (
              <ul
                className="divide-line border-line mt-3 divide-y border-y"
                aria-label="Your connectors"
              >
                {connections.map((connection) => (
                  <ConnectionRow
                    key={connection.id}
                    workspaceId={current.id}
                    connection={connection}
                    onDisconnect={() => setDisconnecting(connection)}
                  />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="add-connector" className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="add-connector" className="text-lg font-semibold">
                Add a connector
              </h2>
              <Button
                variant="secondary"
                size="sm"
                className="gap-2"
                onClick={() => setConnecting("custom")}
              >
                <Plus className="size-4" aria-hidden="true" />
                Custom server
              </Button>
            </div>
            <ul className="divide-line border-line mt-3 divide-y border-y" aria-label="Apps">
              {connectors.data.catalog.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{entry.name}</p>
                    <p className="text-muted text-sm">{entry.description}</p>
                  </div>
                  {connectors.data.blocked.includes(entry.id) ? (
                    <span className="text-muted text-sm">Blocked by your admins</span>
                  ) : connectedIds.has(entry.id) ? (
                    <span className="text-muted text-sm">Connected</span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => setConnecting(entry)}
                      aria-label={`Connect ${entry.name}`}
                    >
                      Connect
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {connecting ? (
        <ConnectDialog
          workspaceId={current.id}
          canShare={connectors.data?.canShare ?? false}
          {...(connecting === "custom" ? {} : { entry: connecting })}
          onClose={() => setConnecting(undefined)}
        />
      ) : null}
      {disconnecting ? (
        <Dialog open onOpenChange={(open) => !open && setDisconnecting(undefined)}>
          <DialogContent
            title={`Disconnect ${disconnecting.name}?`}
            description="Tessel will forget your sign-in and stop offering its tools in chat."
          >
            <FormError message={remove.error?.message} />
            <div className={cn("flex justify-end gap-2", remove.error ? "mt-4" : "mt-6")}>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(disconnecting.id, { onSuccess: () => setDisconnecting(undefined) })
                }
              >
                Disconnect
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
