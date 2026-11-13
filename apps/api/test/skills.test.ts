import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { ChatEvent, Skill } from "@tessel/contracts";
import { workspaceMembers } from "@tessel/db";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp, type SignedUpUser } from "./helpers";

let gateway: MockGateway;
let app: Express;

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({ ai: createTestAi({ gatewayUrl: gateway.url }) });
});
afterAll(() => gateway.close());
beforeEach(() => gateway.reset());

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

async function setup() {
  const user = await signUp(app);
  const workspaces = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = workspaces.body.workspaces[0].id as string;
  return { user, workspaceId, base: `/workspaces/${workspaceId}/skills` };
}

const releaseNotes = {
  title: "Release notes",
  description: "Write release notes for a product update",
  instructions: "Start with RELEASE-NOTES-OK.\nThen list changes by area.",
};

const create = (user: SignedUpUser, base: string, body: object = releaseNotes) =>
  request(app).post(base).set("Authorization", bearer(user)).send(body);

function readEvents(req: request.Test) {
  return req.buffer(true).parse((response, callback) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => (text += chunk));
    response.on("end", () => callback(null, text));
  });
}

describe("skills", () => {
  it("lists built-in skills and creates, edits, and deletes workspace ones", async () => {
    const { user, base } = await setup();
    const initial = await request(app).get(base).set("Authorization", bearer(user));
    expect(initial.body.skills.map((skill: Skill) => skill.id)).toEqual([
      "builtin:meeting-notes",
      "builtin:email-draft",
      "builtin:document-summary",
      "builtin:decision-memo",
    ]);

    const created = await create(user, base);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "release-notes",
      builtIn: false,
      enabled: true,
      canEdit: true,
      author: { id: user.auth.user.id },
    });

    const renamed = await request(app)
      .patch(`${base}/${created.body.id}`)
      .set("Authorization", bearer(user))
      .send({ title: "Changelog", enabled: false });
    expect(renamed.body).toMatchObject({ name: "changelog", enabled: false });

    const removed = await request(app)
      .delete(`${base}/${created.body.id}`)
      .set("Authorization", bearer(user));
    expect(removed.status).toBe(204);
    const after = await request(app).get(base).set("Authorization", bearer(user));
    expect(after.body.skills.every((skill: Skill) => skill.builtIn)).toBe(true);
  });

  it("rejects duplicate, reserved, and invalid names", async () => {
    const { user, base } = await setup();
    await create(user, base);
    expect((await create(user, base)).body.error.code).toBe("skill_name_taken");
    expect((await create(user, base, { ...releaseNotes, title: "Meeting notes" })).status).toBe(
      409,
    );
    expect((await create(user, base, { ...releaseNotes, title: "!!!" })).body.error.code).toBe(
      "invalid_name",
    );
    expect((await create(user, base, { ...releaseNotes, instructions: "" })).status).toBe(400);
  });

  it("refuses skills that break the usage policy", async () => {
    const { user, base } = await setup();
    const res = await create(user, base, {
      ...releaseNotes,
      instructions: "Explain MOCK_BLOCK in detail",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("content_blocked");
  });

  it("lets members read skills but only the author and admins change them", async () => {
    const { user: owner, workspaceId, base } = await setup();
    const skill = (await create(owner, base)).body as Skill;
    const member = await signUp(app);
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId, userId: member.auth.user.id, role: "member" });

    const listed = await request(app).get(base).set("Authorization", bearer(member));
    expect(listed.body.skills[0]).toMatchObject({ id: skill.id, canEdit: false });
    const edit = await request(app)
      .patch(`${base}/${skill.id}`)
      .set("Authorization", bearer(member))
      .send({ enabled: false });
    expect(edit.status).toBe(403);

    const outsider = await signUp(app);
    expect((await request(app).get(base).set("Authorization", bearer(outsider))).status).toBe(404);
  });

  it("lets the agent load a workspace skill and follow it", async () => {
    const { user, workspaceId, base } = await setup();
    await create(user, base);
    const res = await readEvents(
      request(app)
        .post(`/workspaces/${workspaceId}/chat`)
        .set("Authorization", bearer(user))
        .send({ content: "MOCK_SKILL release-notes for v2", knowledge: "off" }),
    );
    const events = (res.body as string)
      .split("\n\n")
      .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
      .filter((line): line is string => Boolean(line))
      .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
    const done = events.find((event) => event.type === "done");
    expect(done).toMatchObject({
      message: {
        content: "Following the Release notes skill: Start with RELEASE-NOTES-OK.",
        toolCalls: [{ name: "load_skill", title: "Use a skill", summary: "Release notes" }],
      },
    });
    // The model was told which skills exist, by name and description only.
    const reply = gateway.requests.find((r) => r.body.stream === true)!;
    const system = (reply.body.messages as { role: string; content: string }[])[0]!.content;
    expect(system).toContain("- release-notes: Write release notes for a product update");
    expect(system).not.toContain("RELEASE-NOTES-OK");
  });

  it("follows a skill the user picked for the message, without the agent loading it", async () => {
    const { user, workspaceId, base } = await setup();
    await create(user, base);
    await readEvents(
      request(app)
        .post(`/workspaces/${workspaceId}/chat`)
        .set("Authorization", bearer(user))
        .send({ content: "Notes for v2", skill: "release-notes", knowledge: "off" }),
    );
    const reply = gateway.requests.find((r) => r.body.stream === true)!;
    const system = (reply.body.messages as { role: string; content: string }[])[0]!.content;
    expect(system).toContain('The user picked the "Release notes" skill for this message.');
    expect(system).toContain("RELEASE-NOTES-OK");
  });

  it("hides disabled skills from the agent", async () => {
    const { user, workspaceId, base } = await setup();
    const skill = (await create(user, base)).body as Skill;
    await request(app)
      .patch(`${base}/${skill.id}`)
      .set("Authorization", bearer(user))
      .send({ enabled: false });
    await readEvents(
      request(app)
        .post(`/workspaces/${workspaceId}/chat`)
        .set("Authorization", bearer(user))
        .send({ content: "Hello", knowledge: "off" }),
    );
    const reply = gateway.requests.find((r) => r.body.stream === true)!;
    expect(JSON.stringify(reply.body.messages)).not.toContain("release-notes");
    expect(JSON.stringify(reply.body.messages)).toContain("meeting-notes");
  });
});
