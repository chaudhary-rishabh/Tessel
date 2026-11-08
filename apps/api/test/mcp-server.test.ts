import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { memoryVectorIndex, sparseVector } from "@tessel/ai";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { AccessToken, CreateAccessTokenResponse } from "@tessel/contracts";
import { documents, personalAccessTokens, workspaceMembers } from "@tessel/db";
import { createLogger } from "@tessel/logger";
import { createMcpServerApp } from "@tessel/mcp/server";
import { memoryObjectStore, memoryUploadQueue } from "@tessel/storage/testing";
import { storageKeys } from "@tessel/storage";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp, type SignedUpUser } from "./helpers";

let gateway: MockGateway;
let app: Express;
let apiServer: Server;
let mcpServer: Server;
let mcpUrl: string;
const objects = memoryObjectStore();
const index = memoryVectorIndex();

const listen = (handler: Express) =>
  new Promise<Server>((resolve) => {
    const server = handler.listen(0, "127.0.0.1", () => resolve(server));
  });
const urlOf = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url, moderation: { mode: "off", failure: "allow" } }),
    storage: { objects, uploads: memoryUploadQueue(), uploadEvents: "api" },
    vectorIndex: index,
  });
  apiServer = await listen(app);
  mcpServer = await listen(
    createMcpServerApp({
      service: "mcp-server",
      apiUrl: urlOf(apiServer),
      logger: createLogger("mcp-test", { level: "silent", pretty: false }),
    }),
  );
  mcpUrl = `${urlOf(mcpServer)}/mcp`;
});
afterAll(async () => {
  await gateway.close();
  apiServer.closeAllConnections();
  mcpServer.closeAllConnections();
  await new Promise((resolve) => apiServer.close(resolve));
  await new Promise((resolve) => mcpServer.close(resolve));
});

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

async function setup() {
  const user = await signUp(app);
  const workspaces = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = workspaces.body.workspaces[0].id as string;
  return { user, workspaceId, base: `/workspaces/${workspaceId}` };
}

async function makeToken(
  user: SignedUpUser,
  base: string,
  body: object = { name: "Claude Desktop" },
) {
  const res = await request(app)
    .post(`${base}/access-tokens`)
    .set("Authorization", bearer(user))
    .send(body);
  return res.body as CreateAccessTokenResponse;
}

async function seedDocument(workspaceId: string, userId: string) {
  const [row] = await ownerDb()
    .insert(documents)
    .values({
      workspaceId,
      userId,
      filename: "travel-policy.md",
      mediaType: "text/markdown",
      sizeBytes: 50,
      storageKey: `workspaces/${workspaceId}/documents/x/original`,
      status: "ready",
    })
    .returning();
  const text = "Travel policy. The zephyrine allowance is 40 euros a day.";
  await objects.put(storageKeys.documentText(workspaceId, row!.id), text, "text/plain");
  await index.upsert([
    {
      payload: {
        workspace_id: workspaceId,
        document_id: row!.id,
        chunk_index: 0,
        text,
        filename: "travel-policy.md",
      },
      dense: new Array(1536).fill(0.01),
      sparse: sparseVector(text),
    },
  ]);
  return row!;
}

async function mcpClient(token: string) {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

const textOf = (result: unknown) =>
  ((result as { content: { text: string }[] }).content[0]?.text ?? "").trim();

describe("personal access tokens", () => {
  it("shows a token once, lists it by prefix, and revokes it", async () => {
    const { user, base } = await setup();
    const created = await makeToken(user, base, { name: "Cursor", expiresInDays: 30 });
    expect(created.token).toMatch(/^tsl_pat_[A-Za-z0-9_-]{32}$/);
    expect(created.accessToken).toMatchObject({
      name: "Cursor",
      prefix: created.token.slice(0, 12),
      scopes: ["documents:read"],
      lastUsedAt: null,
    });

    const list = await request(app).get(`${base}/access-tokens`).set("Authorization", bearer(user));
    expect(list.body.tokens.map((token: AccessToken) => token.id)).toEqual([
      created.accessToken.id,
    ]);
    expect(JSON.stringify(list.body)).not.toContain(created.token);

    const [row] = await ownerDb()
      .select()
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.id, created.accessToken.id));
    expect(row!.tokenHash).toHaveLength(64);
    expect(row!.tokenHash).not.toContain(created.token.slice(8));

    const revoked = await request(app)
      .delete(`${base}/access-tokens/${created.accessToken.id}`)
      .set("Authorization", bearer(user));
    expect(revoked.status).toBe(204);
    const after = await request(app)
      .get(`${base}/access-tokens`)
      .set("Authorization", bearer(user));
    expect(after.body.tokens).toEqual([]);
  });

  it("reaches only the routes tokens are allowed on, in their own workspace", async () => {
    const { user, base } = await setup();
    const { token } = await makeToken(user, base);
    const withToken = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);

    expect((await withToken(request(app).get(`${base}/documents`))).status).toBe(200);
    expect(
      (await withToken(request(app).post(`${base}/search`).send({ query: "allowance" }))).status,
    ).toBe(200);
    expect((await withToken(request(app).get("/access-tokens/current"))).body).toMatchObject({
      scopes: ["documents:read"],
    });

    for (const blocked of [
      request(app).get("/users/me"),
      request(app).get("/workspaces"),
      request(app).get(`${base}/threads`),
      request(app).post(`${base}/access-tokens`).send({ name: "escalate" }),
      request(app).post(`${base}/chat`).send({ content: "hi" }),
    ]) {
      const res = await withToken(blocked);
      expect(res.status).toBe(403);
    }

    const other = await setup();
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId: other.workspaceId, userId: user.auth.user.id, role: "member" });
    const elsewhere = await withToken(request(app).get(`${other.base}/documents`));
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body.error.message).toBe("This token belongs to a different workspace");
  });

  it("stops working when revoked, expired, or when the owner leaves the workspace", async () => {
    const { user, base } = await setup();
    const revoked = await makeToken(user, base);
    await request(app)
      .delete(`${base}/access-tokens/${revoked.accessToken.id}`)
      .set("Authorization", bearer(user));
    expect(
      (await request(app).get(`${base}/documents`).set("Authorization", `Bearer ${revoked.token}`))
        .status,
    ).toBe(401);

    const expired = await makeToken(user, base);
    await ownerDb()
      .update(personalAccessTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(personalAccessTokens.id, expired.accessToken.id));
    expect(
      (await request(app).get(`${base}/documents`).set("Authorization", `Bearer ${expired.token}`))
        .status,
    ).toBe(401);

    const owner = await signUp(app);
    const ownerWorkspace = (
      await request(app).get("/workspaces").set("Authorization", bearer(owner))
    ).body.workspaces[0].id as string;
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId: ownerWorkspace, userId: user.auth.user.id, role: "member" });
    const guest = await makeToken(user, `/workspaces/${ownerWorkspace}`);
    await ownerDb().delete(workspaceMembers).where(eq(workspaceMembers.userId, user.auth.user.id));
    expect(
      (
        await request(app)
          .get(`/workspaces/${ownerWorkspace}/documents`)
          .set("Authorization", `Bearer ${guest.token}`)
      ).status,
    ).toBe(401);
  });

  it("rejects malformed and unknown tokens", async () => {
    const { base } = await setup();
    for (const header of ["Bearer tsl_pat_unknown", "Bearer tsl_pat_", "Basic abc"]) {
      const res = await request(app).get(`${base}/documents`).set("Authorization", header);
      expect(res.status, header).toBe(401);
    }
  });
});

describe("Tessel MCP server", () => {
  it("lets an outside MCP client search, list, and read the workspace's documents", async () => {
    const { user, workspaceId, base } = await setup();
    const document = await seedDocument(workspaceId, user.auth.user.id);
    const { token, accessToken } = await makeToken(user, base);
    const client = await mcpClient(token);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([
      ["search_documents", true],
      ["list_documents", true],
      ["read_document", true],
    ]);
    expect(client.getInstructions()).toContain("workspace on Tessel");

    const search = await client.callTool({
      name: "search_documents",
      arguments: { query: "zephyrine allowance" },
    });
    expect(textOf(search)).toBe(
      `[1] travel-policy.md (document ${document.id})\nTravel policy. The zephyrine allowance is 40 euros a day.`,
    );
    expect(textOf(await client.callTool({ name: "list_documents", arguments: {} }))).toBe(
      `${document.id}  travel-policy.md  (ready)`,
    );
    const read = await client.callTool({
      name: "read_document",
      arguments: { document_id: document.id },
    });
    expect(textOf(read)).toBe(
      "travel-policy.md\n\nTravel policy. The zephyrine allowance is 40 euros a day.",
    );
    await client.close();

    const list = await request(app).get(`${base}/access-tokens`).set("Authorization", bearer(user));
    expect(
      list.body.tokens.find((item: AccessToken) => item.id === accessToken.id).lastUsedAt,
    ).not.toBeNull();
  });

  it("returns the API's errors as tool errors", async () => {
    const { user, base } = await setup();
    const { token } = await makeToken(user, base);
    const client = await mcpClient(token);
    const missing = await client.callTool({
      name: "read_document",
      arguments: { document_id: "00000000-0000-4000-8000-000000000000" },
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe("Document not found");
    await client.close();
  });

  it("refuses clients without a valid token", async () => {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tsl_pat_wrong" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
    await expect(mcpClient("tsl_pat_wrong")).rejects.toThrow();
  });
});
