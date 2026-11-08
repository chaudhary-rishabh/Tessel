import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/**
 * A small GitHub-like MCP server for tests and local development, with an
 * optional OAuth authorization server built in (metadata discovery, dynamic
 * client registration, PKCE, refresh tokens). Authorization is granted
 * straight away, as if the user clicked Allow.
 *
 * Tools: search_issues (read-only), create_issue (changes data, not
 * destructive), and delete_repository (destructive, no hints given).
 */
export interface MockMcpServer {
  /** The MCP endpoint, e.g. http://127.0.0.1:4400/mcp */
  url: string;
  calls: { tool: string; args: Record<string, unknown> }[];
  issues: { number: number; title: string; body: string }[];
  /** Expires every access token, to test refresh. */
  expireTokens(): void;
  close(): Promise<void>;
}

export interface MockMcpOptions {
  port?: number;
  auth?: "none" | "token" | "oauth";
  /** The bearer token accepted in "token" mode. */
  token?: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");

export async function startMockMcpServer({
  port = 0,
  auth = "none",
  token = "mock-token",
}: MockMcpOptions = {}): Promise<MockMcpServer> {
  const calls: MockMcpServer["calls"] = [];
  const issues: MockMcpServer["issues"] = [
    { number: 1, title: "Login fails on Safari", body: "Users on Safari 18 can't sign in." },
    { number: 2, title: "Add dark mode", body: "Follow the system setting." },
  ];
  const clients = new Map<string, { redirectUris: string[] }>();
  const codes = new Map<string, { clientId: string; challenge: string; redirectUri: string }>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  let base = "";

  function mcpServer() {
    const server = new McpServer({ name: "mock-github", version: "1.0.0" });
    server.registerTool(
      "search_issues",
      {
        title: "Search issues",
        description: "Search the repository's issues by keyword",
        inputSchema: { query: z.string().describe("Words to look for") },
        annotations: { readOnlyHint: true },
      },
      async ({ query }) => {
        calls.push({ tool: "search_issues", args: { query } });
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const found = issues.filter((issue) =>
          words.some((word) => `${issue.title} ${issue.body}`.toLowerCase().includes(word)),
        );
        return {
          content: [
            {
              type: "text",
              text: found.length
                ? found.map((issue) => `#${issue.number} ${issue.title}`).join("\n")
                : "No issues found",
            },
          ],
        };
      },
    );
    server.registerTool(
      "create_issue",
      {
        title: "Create issue",
        description: "Open a new issue in the repository",
        inputSchema: { title: z.string(), body: z.string().optional() },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ title, body }) => {
        calls.push({ tool: "create_issue", args: { title, body } });
        const issue = { number: issues.length + 1, title, body: body ?? "" };
        issues.push(issue);
        return { content: [{ type: "text", text: `Created issue #${issue.number}: ${title}` }] };
      },
    );
    server.registerTool(
      "delete_repository",
      { description: "Delete the repository", inputSchema: { confirm: z.boolean() } },
      async (args) => {
        calls.push({ tool: "delete_repository", args });
        return { content: [{ type: "text", text: "Not allowed in this mock" }], isError: true };
      },
    );
    return server;
  }

  function authorized(req: IncomingMessage): boolean {
    if (auth === "none") return true;
    const header = req.headers.authorization ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    return auth === "token" ? bearer === token : accessTokens.has(bearer);
  }

  function issueTokens(res: ServerResponse) {
    const access = randomBytes(16).toString("hex");
    const refresh = randomBytes(16).toString("hex");
    accessTokens.add(access);
    refreshTokens.add(refresh);
    json(res, 200, {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 3600,
    });
  }

  const http = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", base);
      const path = url.pathname;

      if (path === "/health") return json(res, 200, { status: "ok" });

      if (auth === "oauth") {
        if (path.startsWith("/.well-known/oauth-protected-resource")) {
          return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
        }
        if (path === "/.well-known/oauth-authorization-server") {
          return json(res, 200, {
            issuer: base,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            registration_endpoint: `${base}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
          });
        }
        if (path === "/register" && req.method === "POST") {
          const metadata = JSON.parse(await readBody(req)) as { redirect_uris?: string[] };
          const clientId = `client-${randomBytes(6).toString("hex")}`;
          clients.set(clientId, { redirectUris: metadata.redirect_uris ?? [] });
          return json(res, 201, {
            ...metadata,
            client_id: clientId,
            client_id_issued_at: Math.floor(Date.now() / 1000),
          });
        }
        if (path === "/authorize") {
          const clientId = url.searchParams.get("client_id") ?? "";
          const redirectUri = url.searchParams.get("redirect_uri") ?? "";
          const client = clients.get(clientId);
          if (!client || !client.redirectUris.includes(redirectUri))
            return json(res, 400, { error: "invalid_client" });
          if (url.searchParams.get("code_challenge_method") !== "S256")
            return json(res, 400, { error: "invalid_request" });
          const code = randomBytes(12).toString("hex");
          codes.set(code, {
            clientId,
            challenge: url.searchParams.get("code_challenge") ?? "",
            redirectUri,
          });
          const target = new URL(redirectUri);
          target.searchParams.set("code", code);
          const state = url.searchParams.get("state");
          if (state) target.searchParams.set("state", state);
          res.writeHead(302, { Location: target.toString() });
          return res.end();
        }
        if (path === "/token" && req.method === "POST") {
          const form = new URLSearchParams(await readBody(req));
          if (form.get("grant_type") === "authorization_code") {
            const entry = codes.get(form.get("code") ?? "");
            codes.delete(form.get("code") ?? "");
            if (
              !entry ||
              entry.clientId !== form.get("client_id") ||
              entry.redirectUri !== form.get("redirect_uri") ||
              sha256(form.get("code_verifier") ?? "") !== entry.challenge
            ) {
              return json(res, 400, { error: "invalid_grant" });
            }
            return issueTokens(res);
          }
          if (form.get("grant_type") === "refresh_token") {
            const refresh = form.get("refresh_token") ?? "";
            if (!refreshTokens.delete(refresh)) return json(res, 400, { error: "invalid_grant" });
            return issueTokens(res);
          }
          return json(res, 400, { error: "unsupported_grant_type" });
        }
      }

      if (path === "/mcp") {
        if (!authorized(req)) {
          return json(
            res,
            401,
            { error: "invalid_token" },
            {
              "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
            },
          );
        }
        if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
        const body = JSON.parse((await readBody(req)) || "null") as unknown;
        // Stateless: a fresh server and transport per request.
        const server = mcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      json(res, 404, { error: "Not found" });
    })().catch((error: unknown) => {
      if (!res.headersSent) json(res, 500, { error: String(error) });
      else res.destroy();
    });
  });

  await new Promise<void>((resolve) => http.listen(port, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return {
    url: `${base}/mcp`,
    calls,
    issues,
    expireTokens: () => accessTokens.clear(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
