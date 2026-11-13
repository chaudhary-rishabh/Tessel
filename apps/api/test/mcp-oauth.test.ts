import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { createLogger } from "@tessel/logger";
import { createMcpServerApp } from "@tessel/mcp/server";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, signUp, type SignedUpUser } from "./helpers";

let api: Express;
let apiServer: Server;
let mcpServer: Server;
let apiUrl: string;
let mcpUrl: string;
const REDIRECT_URI = "http://127.0.0.1:33418/callback";

const listen = () =>
  new Promise<Server>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
/** Fields the OAuth endpoints answer with. */
interface OAuthJson {
  client_id: string;
  access_token: string;
  refresh_token: string;
  error?: string;
}
const json = async (response: Response) => (await response.json()) as OAuthJson;

const urlOf = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

beforeAll(async () => {
  // Bind first, so the issuer and resource URLs carry the real ports.
  apiServer = await listen();
  mcpServer = await listen();
  apiUrl = urlOf(apiServer);
  mcpUrl = `${urlOf(mcpServer)}/mcp`;
  api = createTestApp({ signIn: { apiPublicUrl: apiUrl, mcpResourceUrl: mcpUrl } });
  apiServer.on("request", api);
  mcpServer.on(
    "request",
    createMcpServerApp({
      service: "mcp-server",
      apiUrl,
      logger: createLogger("mcp-test", { level: "silent", pretty: false }),
      oauth: { resourceUrl: mcpUrl, authorizationServerUrl: `${apiUrl}/` },
    }),
  );
});
afterAll(async () => {
  apiServer.closeAllConnections();
  mcpServer.closeAllConnections();
  await new Promise((resolve) => apiServer.close(resolve));
  await new Promise((resolve) => mcpServer.close(resolve));
});

async function workspaceOf(user: SignedUpUser) {
  const res = await request(api).get("/workspaces").set("Authorization", bearer(user));
  return res.body.workspaces[0] as { id: string; name: string };
}

/** The consent page's part: what the user sees after the client sends them to Tessel. */
async function consent(
  user: SignedUpUser,
  consentUrl: string,
  decision: "approve" | "deny",
  scopes?: string[],
) {
  const id = new URL(consentUrl).pathname.split("/").at(-1)!;
  const described = await request(api)
    .get(`/oauth/authorizations/${id}`)
    .set("Authorization", bearer(user));
  expect(described.status).toBe(200);
  const workspace = await workspaceOf(user);
  const res = await request(api)
    .post(`/oauth/authorizations/${id}/${decision}`)
    .set("Authorization", bearer(user))
    .send({ workspaceId: workspace.id, scopes });
  expect(res.status).toBe(200);
  return { described: described.body, redirectUrl: new URL(res.body.redirectUrl as string) };
}

/** An MCP client, as the SDK's own OAuth support drives it. */
function sdkClient() {
  const state: {
    info?: OAuthClientInformationMixed;
    tokens?: OAuthTokens;
    verifier?: string;
    authorizationUrl?: URL;
  } = {};
  const provider: OAuthClientProvider = {
    redirectUrl: REDIRECT_URI,
    clientMetadata: {
      client_name: "Test Desktop",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    clientInformation: () => state.info,
    saveClientInformation: (info) => {
      state.info = info;
    },
    tokens: () => state.tokens,
    saveTokens: (tokens) => {
      state.tokens = tokens;
    },
    redirectToAuthorization: (url) => {
      state.authorizationUrl = url;
    },
    saveCodeVerifier: (verifier) => {
      state.verifier = verifier;
    },
    codeVerifier: () => state.verifier!,
  };
  return { provider, state };
}

async function connectWith(token: string) {
  const client = new Client({ name: "oauth-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

describe("signing MCP clients in with OAuth", () => {
  it("advertises where to sign in", async () => {
    const challenge = await fetch(mcpUrl, { method: "POST", body: "{}" });
    expect(challenge.status).toBe(401);
    const header = challenge.headers.get("www-authenticate")!;
    expect(header).toContain(
      `resource_metadata="${urlOf(mcpServer)}/.well-known/oauth-protected-resource/mcp"`,
    );

    const resource = await (
      await fetch(`${urlOf(mcpServer)}/.well-known/oauth-protected-resource/mcp`)
    ).json();
    expect(resource).toMatchObject({ resource: mcpUrl, authorization_servers: [`${apiUrl}/`] });

    const metadata = await (await fetch(`${apiUrl}/.well-known/oauth-authorization-server`)).json();
    expect(metadata).toMatchObject({
      issuer: `${apiUrl}/`,
      authorization_endpoint: `${apiUrl}/authorize`,
      token_endpoint: `${apiUrl}/token`,
      registration_endpoint: `${apiUrl}/register`,
      code_challenge_methods_supported: ["S256"],
    });
    // Older clients ask the MCP host; it passes on the API's answer.
    const proxied = await (
      await fetch(`${urlOf(mcpServer)}/.well-known/oauth-authorization-server`)
    ).json();
    expect(proxied).toEqual(metadata);
  });

  it("works end to end with the MCP SDK's own client: register, consent, tokens, tools", async () => {
    const user = await signUp(api);
    const { provider, state } = sdkClient();

    expect(await auth(provider, { serverUrl: mcpUrl })).toBe("REDIRECT");
    expect(state.info?.client_id).toBeDefined();
    expect(state.authorizationUrl!.origin).toBe(apiUrl);
    expect(state.authorizationUrl!.searchParams.get("resource")).toBe(mcpUrl);

    // The browser opens the authorization URL; Tessel sends it to the consent page.
    const authorize = await fetch(state.authorizationUrl!, { redirect: "manual" });
    expect(authorize.status).toBe(302);
    const consentUrl = authorize.headers.get("location")!;
    expect(consentUrl).toMatch(/^http:\/\/localhost:3000\/oauth\/consent\/[0-9a-f-]{36}$/);

    // The user allows reading and asking, but not adding documents.
    const { described, redirectUrl } = await consent(user, consentUrl, "approve", [
      "documents:read",
      "chat:write",
    ]);
    expect(described).toMatchObject({
      client: { name: "Test Desktop" },
      redirectHost: "127.0.0.1:33418",
      scopes: ["documents:read", "documents:write", "chat:write"],
    });
    expect(`${redirectUrl.origin}${redirectUrl.pathname}`).toBe(REDIRECT_URI);
    expect(redirectUrl.searchParams.get("state")).toBe(
      state.authorizationUrl!.searchParams.get("state"),
    );

    const code = redirectUrl.searchParams.get("code")!;
    expect(await auth(provider, { serverUrl: mcpUrl, authorizationCode: code })).toBe("AUTHORIZED");
    expect(state.tokens?.access_token).toMatch(/^tsl_oat_/);
    expect(state.tokens?.refresh_token).toBeDefined();
    expect(state.tokens?.expires_in).toBe(3600);

    const client = await connectWith(state.tokens!.access_token);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "search_documents",
      "list_documents",
      "read_document",
      "ask_tessel",
    ]);
    const listed = await client.callTool({ name: "list_documents", arguments: {} });
    expect(listed.isError).toBeFalsy();
    await client.close();

    // Hour-long tokens don't show up as hand-made access tokens.
    const workspace = await workspaceOf(user);
    const handMade = await request(api)
      .get(`/workspaces/${workspace.id}/access-tokens`)
      .set("Authorization", bearer(user));
    expect(handMade.body.tokens).toEqual([]);

    const apps = await request(api)
      .get("/users/me/connected-apps")
      .set("Authorization", bearer(user));
    expect(apps.body.apps).toEqual([
      expect.objectContaining({
        name: "Test Desktop",
        workspace: { id: workspace.id, name: workspace.name },
        scopes: ["documents:read", "chat:write"],
      }),
    ]);
  });

  it("can't use a code twice, or with the wrong verifier", async () => {
    const user = await signUp(api);
    const registration = await json(
      await fetch(`${apiUrl}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Manual",
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "none",
        }),
      }),
    );
    const verifier = randomBytes(32).toString("base64url");
    const authorizeUrl = new URL(`${apiUrl}/authorize`);
    authorizeUrl.search = new URLSearchParams({
      client_id: registration.client_id,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "xyz",
    }).toString();
    const authorize = await fetch(authorizeUrl, { redirect: "manual" });
    const { redirectUrl } = await consent(user, authorize.headers.get("location")!, "approve");
    const code = redirectUrl.searchParams.get("code")!;

    const token = (codeVerifier: string) =>
      fetch(`${apiUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: registration.client_id,
          code,
          code_verifier: codeVerifier,
          redirect_uri: REDIRECT_URI,
        }),
      });
    const wrong = await token(randomBytes(32).toString("base64url"));
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).error).toBe("invalid_grant");
    const right = await token(verifier);
    expect(right.status).toBe(200);
    const tokens = await json(right);
    const again = await token(verifier);
    expect((await json(again)).error).toBe("invalid_grant");

    // Refreshing rotates the refresh token; replaying the old one ends the grant.
    const refresh = (refreshToken: string) =>
      fetch(`${apiUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: registration.client_id,
          refresh_token: refreshToken,
        }),
      });
    const rotated = await json(await refresh(tokens.refresh_token));
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    await connectWith(rotated.access_token).then((client) => client.close());

    const replay = await refresh(tokens.refresh_token);
    expect((await json(replay)).error).toBe("invalid_grant");
    await expect(connectWith(rotated.access_token)).rejects.toThrow();
    expect((await json(await refresh(rotated.refresh_token))).error).toBe("invalid_grant");
  });

  it("sends the client back with access_denied when the user declines", async () => {
    const user = await signUp(api);
    const { provider, state } = sdkClient();
    await auth(provider, { serverUrl: mcpUrl });
    const authorize = await fetch(state.authorizationUrl!, { redirect: "manual" });
    const { redirectUrl } = await consent(user, authorize.headers.get("location")!, "deny");
    expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
    expect(redirectUrl.searchParams.get("code")).toBeNull();
  });

  it("refuses tokens for another resource", async () => {
    const { provider, state } = sdkClient();
    await auth(provider, { serverUrl: mcpUrl });
    const url = new URL(state.authorizationUrl!);
    url.searchParams.set("resource", "https://other.example/mcp");
    const res = await fetch(url, { redirect: "manual" });
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
  });

  it("only lets the user approve into their own workspaces", async () => {
    const user = await signUp(api);
    const stranger = await signUp(api);
    const { provider, state } = sdkClient();
    await auth(provider, { serverUrl: mcpUrl });
    const authorize = await fetch(state.authorizationUrl!, { redirect: "manual" });
    const id = authorize.headers.get("location")!.split("/").at(-1)!;
    const theirs = await workspaceOf(stranger);
    const res = await request(api)
      .post(`/oauth/authorizations/${id}/approve`)
      .set("Authorization", bearer(user))
      .send({ workspaceId: theirs.id });
    expect(res.status).toBe(404);
    expect((await request(api).get(`/oauth/authorizations/${id}`)).status).toBe(401);
  });

  it("disconnecting an app ends its tokens", async () => {
    const user = await signUp(api);
    const { provider, state } = sdkClient();
    await auth(provider, { serverUrl: mcpUrl });
    const authorize = await fetch(state.authorizationUrl!, { redirect: "manual" });
    const { redirectUrl } = await consent(user, authorize.headers.get("location")!, "approve");
    await auth(provider, {
      serverUrl: mcpUrl,
      authorizationCode: redirectUrl.searchParams.get("code")!,
    });

    const apps = await request(api)
      .get("/users/me/connected-apps")
      .set("Authorization", bearer(user));
    const removed = await request(api)
      .delete(`/users/me/connected-apps/${apps.body.apps[0].id}`)
      .set("Authorization", bearer(user));
    expect(removed.status).toBe(204);
    await expect(connectWith(state.tokens!.access_token)).rejects.toThrow();
  });
});
