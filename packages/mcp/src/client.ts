import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  ConnectionOAuthProvider,
  type ConnectionCredentials,
  type StaticOAuthClient,
} from "./credentials";
import { guardedFetch } from "./url-guard";

/** A tool as an MCP server describes it, cached on the connection. */
export interface RemoteTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** The connection needs the user to sign in again. */
export class ConnectorAuthError extends Error {
  constructor(message = "Sign in to this connector again") {
    super(message);
    this.name = "ConnectorAuthError";
  }
}

export interface ConnectorEndpoint {
  serverUrl: string;
  credentials: ConnectionCredentials;
  /** Called whenever tokens or registration change, to save them. */
  onCredentials?: (credentials: ConnectionCredentials) => void | Promise<void>;
  redirectUrl: string;
  staticClient?: StaticOAuthClient | undefined;
  allowPrivate?: boolean;
  timeoutMs?: number;
}

export interface ConnectorClient {
  listTools(): Promise<RemoteTool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolCallOutput>;
  close(): Promise<void>;
}

export interface ToolCallOutput {
  text: string;
  isError: boolean;
}

const CLIENT_INFO = { name: "Tessel", version: "1.0.0" };
const MAX_TEXT = 50_000;

/** Flattens an MCP tool result into text the model can read. */
export function resultText(raw: unknown): ToolCallOutput {
  const result = (raw ?? {}) as {
    content?: unknown;
    structuredContent?: unknown;
    isError?: unknown;
  };
  const parts = Array.isArray(result.content) ? result.content : [];
  const lines = parts.map(
    (part: {
      type?: string;
      text?: string;
      resource?: { uri?: string; text?: string };
      uri?: string;
      name?: string;
    }) => {
      switch (part.type) {
        case "text":
          return part.text ?? "";
        case "resource":
          return part.resource?.text ?? `[resource ${part.resource?.uri ?? ""}]`;
        case "resource_link":
          return `[link ${part.name ?? ""} ${part.uri ?? ""}]`;
        case "image":
          return "[image]";
        case "audio":
          return "[audio]";
        default:
          return "";
      }
    },
  );
  if (lines.every((line) => !line) && result.structuredContent !== undefined) {
    lines.push(JSON.stringify(result.structuredContent, null, 2));
  }
  const text = lines.filter(Boolean).join("\n");
  return {
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[truncated]` : text,
    isError: result.isError === true,
  };
}

function transportFor(endpoint: ConnectorEndpoint) {
  const fetchFn = guardedFetch({ allowPrivate: endpoint.allowPrivate ?? false });
  const { credentials } = endpoint;
  if (credentials.type === "oauth") {
    const provider = new ConnectionOAuthProvider(credentials, {
      redirectUrl: endpoint.redirectUrl,
      clientName: "Tessel",
      staticClient: endpoint.staticClient,
      onChange: (next) => endpoint.onCredentials?.(next),
    });
    return new StreamableHTTPClientTransport(new URL(endpoint.serverUrl), {
      authProvider: provider,
      fetch: fetchFn,
    });
  }
  return new StreamableHTTPClientTransport(new URL(endpoint.serverUrl), {
    fetch: fetchFn,
    ...(credentials.type === "token"
      ? { requestInit: { headers: { Authorization: `Bearer ${credentials.token}` } } }
      : {}),
  });
}

function isAuthFailure(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b401\b|unauthori[sz]ed|invalid_token/i.test(message);
}

/** Connects to a remote MCP server over Streamable HTTP. */
export async function connectToServer(endpoint: ConnectorEndpoint): Promise<ConnectorClient> {
  const client = new Client(CLIENT_INFO);
  const timeout = endpoint.timeoutMs ?? 30_000;
  try {
    await client.connect(transportFor(endpoint), { timeout });
  } catch (error) {
    await client.close().catch(() => undefined);
    if (isAuthFailure(error)) throw new ConnectorAuthError();
    throw error;
  }
  const wrap = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (isAuthFailure(error)) throw new ConnectorAuthError();
      throw error;
    }
  };
  return {
    listTools: () =>
      wrap(async () => {
        const tools: RemoteTool[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : {}, { timeout });
          tools.push(...(page.tools as RemoteTool[]));
          cursor = page.nextCursor;
        } while (cursor && tools.length < 500);
        return tools;
      }),
    callTool: (name, args, signal) =>
      wrap(async () =>
        resultText(
          await client.callTool({ name, arguments: args }, undefined, {
            timeout,
            ...(signal ? { signal } : {}),
          }),
        ),
      ),
    close: () => client.close(),
  };
}

/**
 * Starts an OAuth sign-in: discovers the server's authorization server,
 * registers Tessel as a client if needed, and returns the URL to send the
 * user to. The credentials passed to `onCredentials` must be saved for the
 * callback (they hold the PKCE verifier).
 */
export async function beginOAuth(
  endpoint: Omit<ConnectorEndpoint, "credentials"> & { state: string },
): Promise<URL> {
  const provider = new ConnectionOAuthProvider(
    { type: "oauth" },
    {
      redirectUrl: endpoint.redirectUrl,
      clientName: "Tessel",
      state: endpoint.state,
      staticClient: endpoint.staticClient,
      onChange: (next) => endpoint.onCredentials?.(next),
    },
  );
  const result = await auth(provider, {
    serverUrl: endpoint.serverUrl,
    fetchFn: guardedFetch({ allowPrivate: endpoint.allowPrivate ?? false }),
  });
  if (result !== "REDIRECT" || !provider.authorizationUrl) {
    throw new Error("The server didn't ask for a sign-in");
  }
  return provider.authorizationUrl;
}

/** Finishes an OAuth sign-in with the code from the callback; returns the new credentials. */
export async function completeOAuth(
  endpoint: ConnectorEndpoint & { code: string },
): Promise<ConnectionCredentials> {
  if (endpoint.credentials.type !== "oauth") throw new Error("This connection doesn't use OAuth");
  let latest: ConnectionCredentials = endpoint.credentials;
  const provider = new ConnectionOAuthProvider(endpoint.credentials, {
    redirectUrl: endpoint.redirectUrl,
    clientName: "Tessel",
    staticClient: endpoint.staticClient,
    onChange: (next) => {
      latest = next;
    },
  });
  const result = await auth(provider, {
    serverUrl: endpoint.serverUrl,
    authorizationCode: endpoint.code,
    fetchFn: guardedFetch({ allowPrivate: endpoint.allowPrivate ?? false }),
  });
  if (result !== "AUTHORIZED") throw new ConnectorAuthError("The sign-in didn't finish");
  return latest;
}
