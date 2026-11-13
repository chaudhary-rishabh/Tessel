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

describe("workspace policies", () => {
  const tools = (...calls: { name: string; args: Record<string, unknown> }[]) =>
    `MOCK_TOOLS ${JSON.stringify(calls)}`;
  const offered = () =>
    (
      (gateway.requests.find((entry) => entry.body.stream === true)?.body.tools ?? []) as {
        function: { name: string };
      }[]
    ).map((tool) => tool.function.name);

  async function teamWithMember() {
    const admin = await setup();
    const member = await signUp(app);
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId: admin.workspaceId, userId: member.auth.user.id, role: "member" });
    return { ...admin, member };
  }

  it("lets owners block tools, require approval, or skip it, and members only read", async () => {
    const { user, base, member } = await teamWithMember();
    const read = await request(app).get(`${base}/policies`).set("Authorization", bearer(member));
    expect(read.body).toMatchObject({ toolPolicies: {}, canEdit: false });
    expect(read.body.tools.map((tool: { name: string }) => tool.name)).toContain("create_document");
    const refused = await request(app)
      .put(`${base}/policies`)
      .set("Authorization", bearer(member))
      .send({ toolPolicies: { calculator: "block" } });
    expect(refused.status).toBe(403);

    const saved = await request(app)
      .put(`${base}/policies`)
      .set("Authorization", bearer(user))
      .send({
        toolPolicies: { calculator: "block", current_time: "ask", create_document: "allow" },
      });
    expect(saved.status).toBe(200);
    expect(saved.body.canEdit).toBe(true);

    // Blocked: not offered to the model at all.
    await chat(member, base, "What's 2 + 2?");
    expect(offered()).not.toContain("calculator");
    expect(offered()).toContain("current_time");

    // "ask" makes a read tool wait for approval.
    gateway.reset();
    const asked = await chat(member, base, tools({ name: "current_time", args: {} }));
    const waiting = asked.find((event) => event.type === "done") as Extract<
      ChatEvent,
      { type: "done" }
    >;
    expect(waiting.status).toBe("waiting");

    // "allow" lets a write tool run without asking.
    gateway.reset();
    const allowed = await chat(
      member,
      base,
      tools({ name: "create_document", args: { filename: "notes.md", content: "Hi" } }),
    );
    const done = allowed.find((event) => event.type === "done") as Extract<
      ChatEvent,
      { type: "done" }
    >;
    expect(done.status).toBe("complete");
    expect(done.message.toolCalls[0]).toMatchObject({
      name: "create_document",
      status: "completed",
    });

    const unknown = await request(app)
      .put(`${base}/policies`)
      .set("Authorization", bearer(user))
      .send({ toolPolicies: { made_up: "block" } });
    expect(unknown.status).toBe(400);
  });

  it("blocks connectors for the whole workspace", async () => {
    const { user, base, member } = await teamWithMember();
    expect((await connectGitHub(member, base)).status).toBe(201);
    await request(app)
      .put(`${base}/policies`)
      .set("Authorization", bearer(user))
      .send({ blockedConnectors: ["github"] });

    const list = await request(app).get(`${base}/connectors`).set("Authorization", bearer(member));
    expect(list.body.blocked).toEqual(["github"]);
    // An existing connection stops working, and a new one can't be added.
    await chat(member, base, "List my issues");
    expect(offered().some((name) => name.startsWith("github"))).toBe(false);
    const again = await connectGitHub(user, base);
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe("connector_blocked");
  });

  it("shares an admin's connector with everyone, who can use but not change it", async () => {
    const { user, base, member } = await teamWithMember();
    const notAllowed = await request(app)
      .post(`${base}/connectors`)
      .set("Authorization", bearer(member))
      .send({ catalogId: "github", token: "ghp_valid", shared: true });
    expect(notAllowed.status).toBe(403);

    const shared = await request(app)
      .post(`${base}/connectors`)
      .set("Authorization", bearer(user))
      .send({ catalogId: "github", token: "ghp_valid", shared: true });
    expect(shared.status).toBe(201);
    const list = await request(app).get(`${base}/connectors`).set("Authorization", bearer(member));
    expect(list.body.connections).toEqual([
      expect.objectContaining({ id: shared.body.connection.id, shared: true, mine: false }),
    ]);
    expect(list.body.canShare).toBe(false);

    await chat(member, base, "List my issues");
    expect(offered().some((name) => name.startsWith("github"))).toBe(true);

    const change = await request(app)
      .patch(`${base}/connectors/${shared.body.connection.id}`)
      .set("Authorization", bearer(member))
      .send({ enabled: false });
    expect(change.status).toBe(404);
  });

  it("turns built-in skills off for the workspace", async () => {
    const { user, workspaceId, base, member } = await teamWithMember();
    const refused = await request(app)
      .patch(`${base}/skills/builtin:meeting-notes`)
      .set("Authorization", bearer(member))
      .send({ enabled: false });
    expect(refused.status).toBe(403);
    const off = await request(app)
      .patch(`${base}/skills/builtin:meeting-notes`)
      .set("Authorization", bearer(user))
      .send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ builtIn: true, enabled: false });

    const list = await request(app).get(`${base}/skills`).set("Authorization", bearer(member));
    expect(
      list.body.skills.find((skill: { name: string }) => skill.name === "meeting-notes"),
    ).toMatchObject({
      enabled: false,
      canEdit: false,
    });
    await chat(member, base, "Hello");
    const system = JSON.stringify(
      gateway.requests.find((entry) => entry.body.stream === true)!.body.messages,
    );
    expect(system).not.toContain("meeting-notes");
    expect(workspaceId).toBeTruthy();
  });
});

describe("connector resources and prompts", () => {
  it("lets the agent read a connector's resources and use its prompts", async () => {
    const { user, base } = await setup();
    const connected = await connectGitHub(user, base);
    expect(connected.body.connection).toMatchObject({
      resources: true,
      prompts: ["Triage an issue"],
    });

    const read = await chat(
      user,
      base,
      `MOCK_TOOLS ${JSON.stringify([{ name: "github_read_resource", args: { uri: "repo://mock/README.md" } }])}`,
    );
    const readDone = read.find((event) => event.type === "done") as Extract<
      ChatEvent,
      { type: "done" }
    >;
    expect(readDone.message.toolCalls[0]).toMatchObject({ status: "completed" });
    expect(readDone.message.content).toContain("README-OK");

    gateway.reset();
    const prompt = await chat(
      user,
      base,
      `MOCK_TOOLS ${JSON.stringify([{ name: "github_prompt_triage", args: { number: "7" } }])}`,
    );
    const promptDone = prompt.find((event) => event.type === "done") as Extract<
      ChatEvent,
      { type: "done" }
    >;
    expect(promptDone.message.content).toContain("TRIAGE-OK: label issue #7");
    const offered = (
      gateway.requests.find((entry) => entry.body.stream === true)!.body.tools as {
        function: { name: string };
      }[]
    ).map((tool) => tool.function.name);
    expect(offered).toEqual(
      expect.arrayContaining(["github_list_resources", "github_read_resource"]),
    );
  });
});
