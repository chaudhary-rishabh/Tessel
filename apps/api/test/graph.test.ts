import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { ChatEvent } from "@tessel/contracts";
import { documents } from "@tessel/db";
import { memoryGraphStore } from "@tessel/graph";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp, type SignedUpUser } from "./helpers";

let gateway: MockGateway;
let app: Express;
const graph = memoryGraphStore();

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url, moderation: { mode: "off", failure: "allow" } }),
    graph,
  });
});
afterAll(() => gateway.close());

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

/** A workspace with an org chart document already in the graph, as the worker would leave it. */
async function setup() {
  const user = await signUp(app);
  const workspaces = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = workspaces.body.workspaces[0].id as string;
  const [document] = await ownerDb()
    .insert(documents)
    .values({
      workspaceId,
      userId: user.auth.user.id,
      filename: "org-chart.md",
      mediaType: "text/markdown",
      sizeBytes: 100,
      storageKey: "k",
      status: "ready",
    })
    .returning();
  await graph.replaceDocument(workspaceId, { id: document!.id, filename: "org-chart.md" }, [
    {
      chunkIndex: 0,
      entities: [
        { name: "Alice Chen", type: "Person", description: "" },
        { name: "Payments Team", type: "Team", description: "" },
        { name: "Ledger Service", type: "System", description: "" },
      ],
      relations: [
        {
          source: "Alice Chen",
          target: "Payments Team",
          type: "MANAGES",
          description: "Alice leads payments.",
        },
        { source: "Payments Team", target: "Ledger Service", type: "OWNS", description: "" },
      ],
    },
  ]);
  return { user, workspaceId, base: `/workspaces/${workspaceId}`, documentId: document!.id };
}

function readEvents(req: request.Test) {
  return req.buffer(true).parse((response, callback) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => (text += chunk));
    response.on("end", () => callback(null, text));
  });
}

async function chat(user: SignedUpUser, base: string, body: Record<string, unknown>) {
  const res = await readEvents(
    request(app).post(`${base}/chat`).set("Authorization", bearer(user)).send(body),
  );
  const events = (res.body as string)
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
  const done = events.find((event) => event.type === "done");
  if (done?.type !== "done") throw new Error("No reply");
  return done.message;
}

describe("graph RAG", () => {
  it("answers a relationship question from the graph, with a citation", async () => {
    const { user, base, documentId } = await setup();
    const message = await chat(user, base, {
      content: 'Who does "Alice Chen" manage, and what do they own?',
    });

    expect(message.sources).toEqual([
      expect.objectContaining({
        id: 1,
        documentId,
        filename: "org-chart.md",
        cited: true,
        text: expect.stringContaining(
          "Alice Chen (Person) manages Payments Team (Team): Alice leads payments.",
        ),
      }),
    ]);
    expect(message.sources[0]!.text).toContain("Payments Team (Team) owns Ledger Service (System)");
    // The relationships went to the model as a numbered source.
    const reply = gateway.requests.findLast((r) => r.body.stream === true)!;
    const system = (reply.body.messages as { content: string }[])[0]!.content;
    expect(system).toContain(
      '<source id="1" document="org-chart.md">\nRelationships from the knowledge graph:',
    );
  });

  it("lets the agent explore connections with a tool", async () => {
    const { user, base } = await setup();
    const message = await chat(user, base, {
      knowledge: "off",
      content: `MOCK_TOOLS ${JSON.stringify([{ name: "explore_graph", args: { entity: "Payments Team" } }])}`,
    });
    expect(message.toolCalls[0]).toMatchObject({
      name: "explore_graph",
      title: "Explore connections",
      summary: "Found 2 connections",
    });
    expect(message.sources[0]).toMatchObject({ id: 1, filename: "org-chart.md" });
  });

  it("shows an entity's connections, only within the workspace", async () => {
    const { user, base } = await setup();
    const res = await request(app)
      .get(`${base}/graph`)
      .query({ entity: "alice chen", depth: 2 })
      .set("Authorization", bearer(user));
    expect(res.body).toMatchObject({
      enabled: true,
      counts: { entities: 3, relations: 2 },
      entities: [{ name: "Alice Chen", type: "Person" }],
    });
    expect(res.body.facts.map((fact: { type: string }) => fact.type)).toEqual(["MANAGES", "OWNS"]);

    const stranger = await signUp(app);
    const theirs = await request(app).get("/workspaces").set("Authorization", bearer(stranger));
    const elsewhere = await request(app)
      .get(`/workspaces/${theirs.body.workspaces[0].id}/graph`)
      .query({ entity: "Alice Chen" })
      .set("Authorization", bearer(stranger));
    expect(elsewhere.body).toMatchObject({ counts: { entities: 0 }, facts: [] });
    expect(
      (await request(app).get(`${base}/graph`).set("Authorization", bearer(stranger))).status,
    ).toBe(404);
  });

  it("removes a deleted document's relationships", async () => {
    const { user, workspaceId, base, documentId } = await setup();
    await request(app).delete(`${base}/documents/${documentId}`).set("Authorization", bearer(user));
    expect(await graph.counts(workspaceId)).toEqual({ entities: 0, relations: 0 });
  });
});
