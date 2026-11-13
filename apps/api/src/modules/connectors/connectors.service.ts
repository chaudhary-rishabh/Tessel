import { randomBytes } from "node:crypto";
import { ToolError, type ToolDefinition } from "@tessel/ai";
import {
  createConnectionRequestSchema,
  updateConnectionRequestSchema,
  type ConnectorConnection,
  type ConnectorListResponse,
  type CreateConnectionResponse,
} from "@tessel/contracts";
import {
  connectorConnections,
  withUserContext,
  type ConnectorConnectionRow,
  type Database,
  type Transaction,
  workspacePolicies,
} from "@tessel/db";
import type { Logger } from "@tessel/logger";
import {
  assertSafeUrl,
  beginOAuth,
  completeOAuth,
  connectorTools,
  connectToServer,
  ConnectorAuthError,
  toolTitle,
  UnsafeUrlError,
  type ConnectionCredentials,
  type ConnectorClient,
  type RemoteTool,
  type SecretBox,
  type ToolPolicy,
} from "@tessel/mcp";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { noAudit, type AuditRecorder } from "../../lib/audit";
import { errors } from "../../lib/errors";
import { workspacesRepository } from "../workspaces/workspaces.repository";
import type { CatalogEntry } from "./connectors.catalog";
import { hashToken, sameHash } from "../auth/tokens";

export interface Actor {
  userId: string;
  workspaceId: string;
  requestId?: string;
}

export interface ConnectorsSettings {
  box: SecretBox;
  catalog: CatalogEntry[];
  /** The API's OAuth callback, as browsers reach it. */
  redirectUrl: string;
  /** Where the callback sends the browser afterwards. */
  webOrigin: string;
  allowPrivate: boolean;
}

/** How long an app sign-in can take, from start to callback. */
export const CONNECTOR_STATE_TTL_MS = 10 * 60_000;

function toConnection(row: ConnectorConnectionRow, userId?: string): ConnectorConnection {
  return {
    shared: row.shared,
    mine: userId === undefined || row.userId === userId,
    resources: row.extras.resources ?? false,
    prompts: (row.extras.prompts ?? []).map((prompt) => prompt.title ?? prompt.name),
    id: row.id,
    catalogId: row.catalogId,
    name: row.name,
    serverUrl: row.serverUrl,
    auth: row.auth,
    status: row.status,
    lastError: row.lastError,
    enabled: row.enabled,
    tools: row.tools.map((tool) => ({
      name: tool.name,
      title: toolTitle(tool),
      description: tool.description ?? "",
      readOnly: tool.annotations?.readOnlyHint === true,
      destructive:
        tool.annotations?.readOnlyHint !== true && tool.annotations?.destructiveHint !== false,
      policy: row.toolPolicies[tool.name] ?? "auto",
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Plain-language reasons for failed connections, without internals. */
function describeFailure(error: unknown): string {
  if (error instanceof UnsafeUrlError) return error.message;
  if (error instanceof ConnectorAuthError) return "The server didn't accept the sign-in";
  return "Tessel couldn't reach the server, or it isn't an MCP server";
}

/**
 * Users' connections to MCP servers. Connecting checks the URL, signs in
 * (OAuth or a token), and caches the server's tools; replies then offer those
 * tools to the agent, and every call goes through the user's own sign-in.
 */
export function createConnectorsService({
  db,
  logger,
  settings,
  audit = noAudit,
}: {
  db: Database;
  logger: Logger;
  settings: ConnectorsSettings;
  audit?: AuditRecorder;
}) {
  const recordAdded = (actor: Actor, connection: { id: string; name: string }) =>
    audit.record({
      actorId: actor.userId,
      workspaceId: actor.workspaceId,
      action: "connector.added",
      target: `connector:${connection.id}`,
      metadata: { name: connection.name },
    });
  const { box } = settings;
  const catalogEntry = (id: string | null) => settings.catalog.find((entry) => entry.id === id);

  async function membership(tx: Transaction, actor: Actor) {
    const workspace = await workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId);
    if (!workspace) throw errors.notFound("Workspace not found");
    return workspace;
  }

  /** Connectors the workspace's owners and admins have blocked. */
  async function blockedIn(tx: Transaction, workspaceId: string): Promise<string[]> {
    const [row] = await tx
      .select({ blocked: workspacePolicies.blockedConnectors })
      .from(workspacePolicies)
      .where(eq(workspacePolicies.workspaceId, workspaceId));
    return row?.blocked ?? [];
  }
  const isBlocked = (blocked: string[], row: { catalogId: string | null; name: string }) =>
    blocked.includes(row.catalogId ?? "") || blocked.includes(row.name);
  const canShare = (role: string) => role === "owner" || role === "admin";
  /** The user's own connectors, and the ones shared with the workspace. */
  const visible = (actor: Actor) =>
    and(
      eq(connectorConnections.workspaceId, actor.workspaceId),
      or(eq(connectorConnections.userId, actor.userId), eq(connectorConnections.shared, true)),
    );

  async function find(tx: Transaction, actor: Actor, connectionId: string) {
    const [row] = await tx
      .select()
      .from(connectorConnections)
      .where(
        and(
          eq(connectorConnections.id, connectionId),
          eq(connectorConnections.workspaceId, actor.workspaceId),
          eq(connectorConnections.userId, actor.userId),
        ),
      );
    if (!row) throw errors.notFound("Connector not found");
    return row;
  }

  async function save(
    userId: string,
    connectionId: string,
    values: Partial<ConnectorConnectionRow>,
  ) {
    return withUserContext(db, userId, async (tx) => {
      const [row] = await tx
        .update(connectorConnections)
        .set(values)
        .where(eq(connectorConnections.id, connectionId))
        .returning();
      return row;
    });
  }

  function endpoint(
    row: Pick<ConnectorConnectionRow, "serverUrl" | "catalogId">,
    credentials: ConnectionCredentials,
  ) {
    return {
      serverUrl: row.serverUrl,
      credentials,
      redirectUrl: settings.redirectUrl,
      staticClient: catalogEntry(row.catalogId)?.staticClient,
      allowPrivate: settings.allowPrivate,
    };
  }

  /** Connects with saved credentials, keeping any refreshed tokens. */
  async function open(row: ConnectorConnectionRow): Promise<ConnectorClient> {
    return connectToServer({
      ...endpoint(row, box.open<ConnectionCredentials>(row.credentials)),
      onCredentials: async (next) => {
        await save(row.userId, row.id, { credentials: box.seal(next) });
      },
    });
  }

  /** Lists the server's tools and marks the connection connected (or why not). */
  async function verify(row: ConnectorConnectionRow, credentials?: ConnectionCredentials) {
    let client: ConnectorClient | undefined;
    try {
      client = credentials
        ? await connectToServer({
            ...endpoint(row, credentials),
            onCredentials: async (next) => {
              credentials = next;
            },
          })
        : await open(row);
      const tools = (await client.listTools()) as RemoteTool[];
      // Resources and prompts are extras: a server that fails to list them still connects.
      const [resources, prompts] = await Promise.all([
        client.listResources().catch(() => []),
        client.listPrompts().catch(() => []),
      ]);
      return save(row.userId, row.id, {
        status: "connected",
        lastError: null,
        tools,
        extras: { resources: resources.length > 0, prompts: prompts.slice(0, 20) },
        ...(credentials ? { credentials: box.seal(credentials) } : {}),
      });
    } catch (error) {
      if (!(error instanceof ConnectorAuthError)) {
        logger.warn({ err: error, connector: row.id }, "Connector check failed");
      }
      return save(row.userId, row.id, {
        status: error instanceof ConnectorAuthError ? "needs_auth" : "error",
        lastError: describeFailure(error),
      });
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  /** Starts an OAuth sign-in and remembers its state; returns the URL to send the user to. */
  async function startOAuth(row: ConnectorConnectionRow): Promise<string> {
    const state = randomBytes(32).toString("base64url");
    let credentials: ConnectionCredentials = { type: "oauth" };
    const url = await beginOAuth({
      ...endpoint(row, credentials),
      state,
      onCredentials: (next) => {
        credentials = next;
      },
    });
    await save(row.userId, row.id, {
      credentials: box.seal(credentials),
      oauthStateHash: hashToken(state),
      oauthStateExpiresAt: new Date(Date.now() + CONNECTOR_STATE_TTL_MS),
      status: "pending",
    });
    return url.toString();
  }

  async function remove(actor: Actor, connectionId: string): Promise<void> {
    await withUserContext(db, actor.userId, async (tx) => {
      await membership(tx, actor);
      await find(tx, actor, connectionId);
      await tx.delete(connectorConnections).where(eq(connectorConnections.id, connectionId));
    });
  }

  return {
    async list(actor: Actor): Promise<ConnectorListResponse> {
      return withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, actor);
        const rows = await tx
          .select()
          .from(connectorConnections)
          .where(visible(actor))
          .orderBy(asc(connectorConnections.createdAt));
        return {
          catalog: settings.catalog.map(({ url: _url, staticClient: _client, ...entry }) => entry),
          connections: rows.map((row) => toConnection(row, actor.userId)),
          blocked: await blockedIn(tx, actor.workspaceId),
          canShare: canShare(workspace.role),
        };
      });
    },

    async create(actor: Actor, input: unknown): Promise<CreateConnectionResponse> {
      const request = createConnectionRequestSchema.parse(input);
      const entry = request.catalogId ? catalogEntry(request.catalogId) : undefined;
      if (request.catalogId && !entry)
        throw errors.badRequest("unknown_connector", "That app isn't available");
      const serverUrl = entry?.url ?? request.serverUrl!;
      try {
        await assertSafeUrl(serverUrl, { allowPrivate: settings.allowPrivate });
      } catch (error) {
        throw errors.badRequest("unsafe_url", describeFailure(error));
      }
      const auth = entry?.auth ?? request.auth ?? "none";
      if (auth === "token" && !request.token) {
        throw errors.badRequest("token_required", "Paste a token");
      }
      const credentials: ConnectionCredentials =
        auth === "token" ? { type: "token", token: request.token! } : { type: auth };

      const row = await withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, actor);
        const name = entry?.name ?? request.name ?? new URL(serverUrl).hostname;
        if (
          isBlocked(await blockedIn(tx, actor.workspaceId), { catalogId: entry?.id ?? null, name })
        ) {
          throw errors.forbidden(
            "This workspace's admins have blocked this connector",
            "connector_blocked",
          );
        }
        if (request.shared && !canShare(workspace.role)) {
          throw errors.forbidden(
            "Only owners and admins can share connectors",
            "connector_share_forbidden",
          );
        }
        const [inserted] = await tx
          .insert(connectorConnections)
          .values({
            shared: request.shared ?? false,
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            catalogId: entry?.id ?? null,
            name: entry?.name ?? request.name ?? new URL(serverUrl).hostname,
            serverUrl,
            auth,
            credentials: box.seal(credentials),
          })
          .returning();
        return inserted!;
      });

      if (auth === "oauth") {
        try {
          const authorizationUrl = await startOAuth(row);
          const pending = await withUserContext(db, actor.userId, (tx) => find(tx, actor, row.id));
          await recordAdded(actor, row);
          return { connection: toConnection(pending), authorizationUrl };
        } catch (error) {
          logger.warn({ err: error, connector: row.id }, "Connector sign-in couldn't start");
          await remove(actor, row.id);
          throw errors.badRequest(
            "connector_unreachable",
            "This server doesn't support signing in with OAuth, or Tessel couldn't reach it",
          );
        }
      }
      const verified = await verify(row, credentials);
      if (verified?.status !== "connected") {
        await remove(actor, row.id);
        throw errors.badRequest(
          verified?.status === "needs_auth" ? "connector_auth_failed" : "connector_unreachable",
          verified?.status === "needs_auth"
            ? "The server didn't accept that token"
            : (verified?.lastError ?? "Tessel couldn't connect"),
        );
      }
      await recordAdded(actor, row);
      return { connection: toConnection(verified), authorizationUrl: null };
    },

    /**
     * Finishes an OAuth sign-in from the browser redirect and returns where to
     * send the browser next. The state is single-use and expires.
     */
    async finishOAuth(query: {
      state?: string;
      code?: string;
      error?: string;
      /** The cookie set when this browser started the sign-in. */
      binding?: string;
    }): Promise<string> {
      const done = (params: Record<string, string>) =>
        `${settings.webOrigin}/connectors?${new URLSearchParams(params).toString()}`;
      if (!query.state) return done({ error: "invalid" });
      // Only the browser that started the sign-in may finish it.
      if (!query.binding || !sameHash(query.binding, hashToken(query.state))) {
        return done({ error: "invalid" });
      }
      const result = await db.execute<{ connection_id: string; owner_id: string }>(
        sql`SELECT * FROM app.connector_for_oauth_state(${hashToken(query.state)})`,
      );
      const match = result.rows[0];
      if (!match) return done({ error: "expired" });
      const row = await withUserContext(db, match.owner_id, async (tx) => {
        const [found] = await tx
          .update(connectorConnections)
          .set({ oauthStateHash: null, oauthStateExpiresAt: null })
          .where(eq(connectorConnections.id, match.connection_id))
          .returning();
        return found;
      });
      if (!row) return done({ error: "expired" });
      if (query.error || !query.code) {
        await save(row.userId, row.id, {
          status: "needs_auth",
          lastError: "The sign-in was cancelled",
        });
        return done({ error: "denied", connection: row.id });
      }
      try {
        const credentials = await completeOAuth({
          ...endpoint(row, box.open<ConnectionCredentials>(row.credentials)),
          code: query.code,
        });
        const verified = await verify(row, credentials);
        return verified?.status === "connected"
          ? done({ connected: row.id })
          : done({ error: "failed", connection: row.id });
      } catch (error) {
        logger.warn({ err: error, connector: row.id }, "Connector sign-in failed");
        await save(row.userId, row.id, { status: "needs_auth", lastError: describeFailure(error) });
        return done({ error: "failed", connection: row.id });
      }
    },

    /** Checks the connection again and refreshes its tools; OAuth connections that need it get a new sign-in URL. */
    async refresh(actor: Actor, connectionId: string): Promise<CreateConnectionResponse> {
      const row = await withUserContext(db, actor.userId, async (tx) => {
        await membership(tx, actor);
        return find(tx, actor, connectionId);
      });
      if (row.auth === "oauth" && row.status !== "connected") {
        return { connection: toConnection(row), authorizationUrl: await startOAuth(row) };
      }
      const verified = await verify(row);
      return { connection: toConnection(verified ?? row), authorizationUrl: null };
    },

    async update(actor: Actor, connectionId: string, input: unknown): Promise<ConnectorConnection> {
      const request = updateConnectionRequestSchema.parse(input);
      const row = await withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, actor);
        const current = await find(tx, actor, connectionId);
        if (request.shared && !canShare(workspace.role)) {
          throw errors.forbidden(
            "Only owners and admins can share connectors",
            "connector_share_forbidden",
          );
        }
        if (request.token && current.auth !== "token") {
          throw errors.badRequest("token_not_used", "This connector doesn't sign in with a token");
        }
        const [updated] = await tx
          .update(connectorConnections)
          .set({
            ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
            ...(request.shared !== undefined ? { shared: request.shared } : {}),
            ...(request.toolPolicies
              ? { toolPolicies: { ...current.toolPolicies, ...request.toolPolicies } }
              : {}),
          })
          .where(eq(connectorConnections.id, connectionId))
          .returning();
        return updated!;
      });
      if (request.token) {
        const verified = await verify(row, { type: "token", token: request.token });
        return toConnection(verified ?? row);
      }
      return toConnection(row);
    },

    async remove(actor: Actor, connectionId: string): Promise<void> {
      await remove(actor, connectionId);
      await audit.record({
        actorId: actor.userId,
        workspaceId: actor.workspaceId,
        action: "connector.removed",
        target: `connector:${connectionId}`,
      });
    },

    /**
     * The user's connector tools for one reply. Clients open on first use and
     * are shared by every call in the reply; close() must run when it ends.
     */
    async forAgent(
      actor: Actor,
    ): Promise<{ tools: ToolDefinition[]; names: string[]; close(): Promise<void> }> {
      const rows = await withUserContext(db, actor.userId, async (tx) => {
        const blocked = await blockedIn(tx, actor.workspaceId);
        const found = await tx
          .select()
          .from(connectorConnections)
          .where(
            and(
              visible(actor),
              eq(connectorConnections.enabled, true),
              eq(connectorConnections.status, "connected"),
            ),
          )
          .orderBy(asc(connectorConnections.createdAt));
        // Blocked connectors are left out; the user's own come before shared ones of the same app.
        return found
          .filter((row) => !isBlocked(blocked, row))
          .sort((a, b) => Number(b.userId === actor.userId) - Number(a.userId === actor.userId));
      });
      const clients = new Map<string, Promise<ConnectorClient>>();
      const taken = new Set<string>();
      const tools = rows.flatMap((row) =>
        connectorTools(
          {
            name: row.name,
            prefix: row.catalogId ?? row.name,
            tools: row.tools,
            policies: row.toolPolicies as Record<string, ToolPolicy>,
            resources: row.extras.resources ?? false,
            prompts: row.extras.prompts ?? [],
            client: async () => {
              let client = clients.get(row.id);
              if (!client) {
                client = open(row).catch(async (error: unknown) => {
                  clients.delete(row.id);
                  if (error instanceof ConnectorAuthError) {
                    await save(row.userId, row.id, {
                      status: "needs_auth",
                      lastError: "Sign in again to keep using this connector",
                    });
                    throw new ToolError(`Sign in to ${row.name} again from the Connectors page`);
                  }
                  throw new ToolError(`${row.name} couldn't be reached`);
                });
                clients.set(row.id, client);
              }
              return client;
            },
          },
          taken,
        ),
      );
      return {
        tools,
        names: tools.map((tool) => tool.name),
        async close() {
          await Promise.all(
            [...clients.values()].map((client) =>
              client.then((open) => open.close()).catch(() => undefined),
            ),
          );
        },
      };
    },
  };
}

export type ConnectorsService = ReturnType<typeof createConnectorsService>;
