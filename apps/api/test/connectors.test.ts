import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { ChatEvent, ConnectorConnection } from "@tessel/contracts";
import { connectorConnections, workspaceMembers } from "@tessel/db";
import { startMockMcpServer, type MockMcpServer } from "@tessel/mcp/testing";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import {
  bearer,
  connect,
  createTestAi,
  createTestApp,
  signUp,
  testConnectors,
  type SignedUpUser,
} from "./helpers";

let gateway: MockGateway;
let github: MockMcpServer;
let oauthServer: MockMcpServer;
let app: Express;

beforeAll(async () => {
  gateway = await startMockGateway();
  github = await startMockMcpServer({ auth: "token", token: "ghp_valid" });
  oauthServer = await startMockMcpServer({ auth: "oauth" });
  app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url, moderation: { mode: "off", failure: "allow" } }),
    connectors: testConnectors({ githubUrl: github.url }),
  });
});
afterAll(async () => {
  await gateway.close();
  await github.close();
  await oauthServer.close();
});
beforeEach(() => {
  gateway.reset();
  github.calls.length = 0;
});

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

async function setup() {
  const user = await signUp(app);
  const workspaces = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = workspaces.body.workspaces[0].id as string;
  return { user, workspaceId, base: `/workspaces/${workspaceId}` };
}

const connectGitHub = (user: SignedUpUser, base: string, token = "ghp_valid") =>
  request(app)
    .post(`${base}/connectors`)
    .set("Authorization", bearer(user))
    .send({ catalogId: "github", token });

function readEvents(req: request.Test) {
  return req.buffer(true).parse((response, callback) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => (text += chunk));
    response.on("end", () => callback(null, text));
  });
}

const parse = (body: string): ChatEvent[] =>
  body
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);

async function chat(user: SignedUpUser, base: string, content: string) {
  const res = await readEvents(
    request(app)
      .post(`${base}/chat`)
      .set("Authorization", bearer(user))
      .send({ content, knowledge: "off" }),
  );
  return parse(res.body as string);
}

const doneOf = (events: ChatEvent[]) => {
  const done = events.find((event) => event.type === "done");
  if (done?.type !== "done") throw new Error(`No done event: ${JSON.stringify(events.at(-1))}`);
  return done;
};

/** The sign-in binding cookie a browser would keep from starting an app sign-in. */
function signInCookie(res: { headers: Record<string, unknown> }): string {
  const cookies = (res.headers["set-cookie"] as string[] | undefined) ?? [];
  return (
    cookies.find((cookie) => cookie.startsWith("tessel_connector_oauth="))?.split(";")[0] ?? ""
  );
}

describe("connectors", () => {
  it("shows the catalog without server details", async () => {
    const { user, base } = await setup();
    const res = await request(app).get(`${base}/connectors`).set("Authorization", bearer(user));
    expect(res.body.catalog.map((entry: { id: string }) => entry.id)).toEqual([
      "github",
      "notion",
      "linear",
    ]);
    expect(res.body.catalog[0]).toMatchObject({
      auth: "token",
      tokenHelp: expect.stringContaining("token"),
    });
    expect(JSON.stringify(res.body)).not.toContain("url");
    expect(res.body.connections).toEqual([]);
  });

  it("connects GitHub with a token, caches its tools, and keeps the token encrypted", async () => {
    const { user, base } = await setup();
    const res = await connectGitHub(user, base);
    expect(res.status).toBe(201);
    const connection = res.body.connection as ConnectorConnection;
    expect(connection).toMatchObject({ name: "GitHub", status: "connected", enabled: true });
    expect(connection.tools.map((tool) => [tool.name, tool.readOnly, tool.destructive])).toEqual([
      ["search_issues", true, false],
      ["create_issue", false, false],
      ["delete_repository", false, true],
    ]);
    expect(JSON.stringify(res.body)).not.toContain("ghp_valid");

    const [row] = await ownerDb()
      .select()
      .from(connectorConnections)
      .where(eq(connectorConnections.id, connection.id));
    expect(row!.credentials).toMatch(/^v1:/);
    expect(row!.credentials).not.toContain("ghp_valid");
  });

  it("refuses a token the server rejects, and leaves nothing behind", async () => {
    const { user, base } = await setup();
    const res = await connectGitHub(user, base, "ghp_wrong");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("connector_auth_failed");
    const list = await request(app).get(`${base}/connectors`).set("Authorization", bearer(user));
    expect(list.body.connections).toEqual([]);
  });

  it("runs read-only tools straight away and asks before changing anything", async () => {
    const { user, base } = await setup();
    await connectGitHub(user, base);

    const search = await chat(
      user,
      base,
      `MOCK_TOOLS ${JSON.stringify([{ name: "github_search_issues", args: { query: "safari" } }])}`,
    );
    expect(doneOf(search).message).toMatchObject({
      content: "Tool result: #1 Login fails on Safari",
      toolCalls: [
        { name: "github_search_issues", title: "GitHub: Search issues", status: "completed" },
      ],
    });
    expect(github.calls).toEqual([{ tool: "search_issues", args: { query: "safari" } }]);

    const events = await chat(
      user,
      base,
      `MOCK_TOOLS ${JSON.stringify([{ name: "github_create_issue", args: { title: "Fix login", body: "Safari" } }])}`,
    );
    const paused = doneOf(events);
    expect(paused.status).toBe("waiting");
    expect(paused.message.toolCalls[0]).toMatchObject({
      status: "waiting",
      requiresApproval: true,
      description: 'GitHub: Create issue with title "Fix login", body "Safari"',
    });
    expect(github.calls).toHaveLength(1);

    const start = events[0];
    if (start?.type !== "start") throw new Error("No start");
    const decision = await readEvents(
      request(app)
        .post(
          `${base}/threads/${start.thread.id}/tool-calls/${encodeURIComponent(paused.message.toolCalls[0]!.id)}/decision`,
        )
        .set("Authorization", bearer(user))
        .send({ approved: true }),
    );
    const finished = doneOf(parse(decision.body as string));
    expect(finished.message.content).toMatch(/^Tool result: Created issue #\d+: Fix login$/);
    expect(github.calls.at(-1)).toEqual({
      tool: "create_issue",
      args: { title: "Fix login", body: "Safari" },
    });
  });

  it("follows the user's tool choices: always allow, or hide", async () => {
    const { user, base } = await setup();
    const { connection } = (await connectGitHub(user, base)).body as {
      connection: ConnectorConnection;
    };
    const updated = await request(app)
      .patch(`${base}/connectors/${connection.id}`)
      .set("Authorization", bearer(user))
      .send({ toolPolicies: { create_issue: "allow", delete_repository: "off" } });
    expect(updated.body.tools.map((tool: { policy: string }) => tool.policy)).toEqual([
      "auto",
      "allow",
      "off",
    ]);

    const events = await chat(
      user,
      base,
      `MOCK_TOOLS ${JSON.stringify([{ name: "github_create_issue", args: { title: "No approval needed" } }])}`,
    );
    expect(doneOf(events).status).toBe("complete");
    const offered = gateway.requests.find((r) => r.body.stream === true)!.body.tools as {
      function: { name: string };
    }[];
    expect(offered.map((tool) => tool.function.name)).not.toContain("github_delete_repository");
  });

  it("leaves switched-off connectors out of replies", async () => {
    const { user, base } = await setup();
    const { connection } = (await connectGitHub(user, base)).body as {
      connection: ConnectorConnection;
    };
    await request(app)
      .patch(`${base}/connectors/${connection.id}`)
      .set("Authorization", bearer(user))
      .send({ enabled: false });
    await chat(user, base, "Hello");
    const offered = gateway.requests.find((r) => r.body.stream === true)!.body.tools as
      { function: { name: string } }[] | undefined;
    expect((offered ?? []).some((tool) => tool.function.name.startsWith("github_"))).toBe(false);
  });

  it("keeps connections private to the user who made them", async () => {
    const { user, workspaceId, base } = await setup();
    const { connection } = (await connectGitHub(user, base)).body as {
      connection: ConnectorConnection;
    };
    const teammate = await signUp(app);
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId, userId: teammate.auth.user.id, role: "admin" });
    const list = await request(app)
      .get(`${base}/connectors`)
      .set("Authorization", bearer(teammate));
    expect(list.body.connections).toEqual([]);
    const remove = await request(app)
      .delete(`${base}/connectors/${connection.id}`)
      .set("Authorization", bearer(teammate));
    expect(remove.status).toBe(404);
  });

  it("connects a custom server with OAuth through the browser redirect", async () => {
    const { user, base } = await setup();
    const res = await request(app)
      .post(`${base}/connectors`)
      .set("Authorization", bearer(user))
      .send({ name: "Tracker", serverUrl: oauthServer.url, auth: "oauth" });
    expect(res.status).toBe(201);
    expect(res.body.connection).toMatchObject({ name: "Tracker", status: "pending" });
    const authorizationUrl = new URL(res.body.authorizationUrl as string);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4000/connectors/oauth/callback",
    );

    // The browser that started the sign-in holds a cookie tying it to the state.
    const binding = signInCookie(res);
    expect(binding).toMatch(/^tessel_connector_oauth=/);

    // The user approves on the app's page, which redirects back to the API.
    const approved = await fetch(authorizationUrl, { redirect: "manual" });
    const callback = new URL(approved.headers.get("location")!);
    // Another browser (say, someone sent this link) can't finish it.
    const elsewhere = await request(app).get(`/connectors/oauth/callback${callback.search}`);
    expect(elsewhere.headers.location).toBe("http://localhost:3000/connectors?error=invalid");
    const back = await request(app)
      .get(`/connectors/oauth/callback${callback.search}`)
      .set("Cookie", binding);
    expect(back.status).toBe(302);
    expect(back.headers.location).toBe(
      `http://localhost:3000/connectors?connected=${res.body.connection.id}`,
    );

    const list = await request(app).get(`${base}/connectors`).set("Authorization", bearer(user));
    expect(list.body.connections[0]).toMatchObject({ status: "connected" });
    expect(list.body.connections[0].tools).toHaveLength(3);

    // The state works once.
    const replay = await request(app)
      .get(`/connectors/oauth/callback${callback.search}`)
      .set("Cookie", binding);
    expect(replay.headers.location).toBe("http://localhost:3000/connectors?error=expired");
  });

  it("records a cancelled sign-in", async () => {
    const { user, base } = await setup();
    const res = await request(app)
      .post(`${base}/connectors`)
      .set("Authorization", bearer(user))
      .send({ name: "Tracker", serverUrl: oauthServer.url, auth: "oauth" });
    const state = new URL(res.body.authorizationUrl as string).searchParams.get("state")!;
    const back = await request(app)
      .get(`/connectors/oauth/callback?state=${encodeURIComponent(state)}&error=access_denied`)
      .set("Cookie", signInCookie(res));
    expect(back.headers.location).toContain("error=denied");
    const list = await request(app).get(`${base}/connectors`).set("Authorization", bearer(user));
    expect(list.body.connections[0]).toMatchObject({
      status: "needs_auth",
      lastError: "The sign-in was cancelled",
    });
  });

  it("rejects unsafe server URLs when private networks are blocked", async () => {
    const strict = createTestApp({ connectors: { ...testConnectors(), allowPrivate: false } });
    const user = await signUp(strict);
    const workspaces = await request(strict).get("/workspaces").set("Authorization", bearer(user));
    const base = `/workspaces/${workspaces.body.workspaces[0].id}`;
    for (const serverUrl of [
      "http://example.com/mcp",
      "https://169.254.169.254/latest",
      oauthServer.url,
    ]) {
      const res = await request(strict)
        .post(`${base}/connectors`)
        .set("Authorization", bearer(user))
        .send({ name: "Bad", serverUrl });
      expect(res.status, serverUrl).toBe(400);
      expect(res.body.error.code).toBe("unsafe_url");
    }
  });
});
