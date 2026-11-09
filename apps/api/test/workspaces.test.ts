import { randomUUID } from "node:crypto";
import { workspaceMembers, workspaces } from "@tessel/db";
import { sql } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { inject } from "vitest";
import { memoryObjectStore, memoryUploadQueue } from "@tessel/storage/testing";
import {
  bearer,
  connect,
  createTestApp,
  signUp,
  testOutbox,
  uniqueEmail,
  type SignedUpUser,
} from "./helpers";

const objects = memoryObjectStore();
const app = createTestApp({
  storage: { objects, uploads: memoryUploadQueue(), uploadEvents: "api" },
});

async function personalWorkspaceId(user: SignedUpUser): Promise<string> {
  const res = await request(app).get("/workspaces").set("Authorization", bearer(user));
  return res.body.workspaces[0].id;
}

describe("workspaces", () => {
  it("lists the user's workspaces, personal first", async () => {
    const user = await signUp(app);
    await request(app)
      .post("/workspaces")
      .set("Authorization", bearer(user))
      .send({ name: "Research" });

    const res = await request(app).get("/workspaces").set("Authorization", bearer(user));
    expect(res.status).toBe(200);
    expect(
      res.body.workspaces.map((w: { name: string; role: string }) => [w.name, w.role]),
    ).toEqual([
      ["Ada's workspace", "owner"],
      ["Research", "owner"],
    ]);
  });

  it("creates a team workspace owned by the creator", async () => {
    const user = await signUp(app);
    const res = await request(app)
      .post("/workspaces")
      .set("Authorization", bearer(user))
      .send({ name: "  Platform team  " });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Platform team", isPersonal: false, role: "owner" });
  });

  it("lets the owner rename a workspace", async () => {
    const user = await signUp(app);
    const id = await personalWorkspaceId(user);
    const res = await request(app)
      .patch(`/workspaces/${id}`)
      .set("Authorization", bearer(user))
      .send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
  });

  it("rejects an invalid workspace ID", async () => {
    const user = await signUp(app);
    const res = await request(app).get("/workspaces/not-a-uuid").set("Authorization", bearer(user));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("returns 404 for a workspace that does not exist", async () => {
    const user = await signUp(app);
    const res = await request(app)
      .get(`/workspaces/${randomUUID()}`)
      .set("Authorization", bearer(user));
    expect(res.status).toBe(404);
  });
});

describe("workspace isolation", () => {
  it("hides another user's workspace from reads, renames, and lists", async () => {
    const alice = await signUp(app, { name: "Alice" });
    const bob = await signUp(app, { name: "Bob" });
    const aliceWorkspace = await personalWorkspaceId(alice);

    const read = await request(app)
      .get(`/workspaces/${aliceWorkspace}`)
      .set("Authorization", bearer(bob));
    expect(read.status).toBe(404);

    const rename = await request(app)
      .patch(`/workspaces/${aliceWorkspace}`)
      .set("Authorization", bearer(bob))
      .send({ name: "Taken over" });
    expect(rename.status).toBe(404);

    const list = await request(app).get("/workspaces").set("Authorization", bearer(bob));
    expect(list.body.workspaces.map((w: { id: string }) => w.id)).not.toContain(aliceWorkspace);

    const stillAlice = await request(app)
      .get(`/workspaces/${aliceWorkspace}`)
      .set("Authorization", bearer(alice));
    expect(stillAlice.body.name).toBe("Alice's workspace");
  });

  it("lets members view but not rename", async () => {
    const owner = await signUp(app, { name: "Owner" });
    const member = await signUp(app, { name: "Member" });
    const workspaceId = await personalWorkspaceId(owner);

    // Membership management arrives later; add the member as the database owner.
    const ownerDb = connect(inject("testDatabaseOwnerUrl")).db;
    await ownerDb
      .insert(workspaceMembers)
      .values({ workspaceId, userId: member.auth.user.id, role: "member" });

    const view = await request(app)
      .get(`/workspaces/${workspaceId}`)
      .set("Authorization", bearer(member));
    expect(view.status).toBe(200);
    expect(view.body.role).toBe("member");

    const rename = await request(app)
      .patch(`/workspaces/${workspaceId}`)
      .set("Authorization", bearer(member))
      .send({ name: "Nope" });
    expect(rename.status).toBe(403);
  });
});

describe("row-level security", () => {
  it("returns no tenant rows to the app role without a user context", async () => {
    await signUp(app);
    const appDb = connect().db;
    const rows = await appDb.select().from(workspaces);
    expect(rows).toEqual([]);
  });

  it("blocks cross-workspace access even when a query has no filter", async () => {
    const alice = await signUp(app, { name: "Alice" });
    const bob = await signUp(app, { name: "Bob" });
    const aliceWorkspace = await personalWorkspaceId(alice);
    const appDb = connect().db;

    const visibleToBob = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${bob.auth.user.id}, true)`);
      // Deliberately unfiltered: RLS must still limit this to Bob's rows.
      return tx.select({ id: workspaces.id }).from(workspaces);
    });
    expect(visibleToBob.map((row) => row.id)).not.toContain(aliceWorkspace);
    expect(visibleToBob).toHaveLength(1);

    const updated = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${bob.auth.user.id}, true)`);
      return tx
        .update(workspaces)
        .set({ name: "Hijacked" })
        .where(sql`${workspaces.id} = ${aliceWorkspace}`)
        .returning({ id: workspaces.id });
    });
    expect(updated).toEqual([]);
  });

  it("stops a user from adding themselves to someone else's workspace", async () => {
    const alice = await signUp(app, { name: "Alice" });
    const mallory = await signUp(app, { name: "Mallory" });
    const aliceWorkspace = await personalWorkspaceId(alice);
    const appDb = connect().db;

    await expect(
      appDb.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${mallory.auth.user.id}, true)`);
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: aliceWorkspace, userId: mallory.auth.user.id, role: "owner" });
      }),
    ).rejects.toThrow();
  });

  it("lets the owner delete a team workspace with its files, once they type its name", async () => {
    const owner = await signUp(app);
    const created = await request(app)
      .post("/workspaces")
      .set("Authorization", bearer(owner))
      .send({ name: "Old project" });
    const workspaceId = created.body.id as string;
    // A member, and a file attached in chat.
    const email = uniqueEmail();
    await request(app)
      .post(`/workspaces/${workspaceId}/invitations`)
      .set("Authorization", bearer(owner))
      .send({ email, role: "admin" });
    const token = /\/invite\/([\w-]+)/.exec(testOutbox.latest(email)!.text)![1]!;
    const admin = await signUp(app, { email });
    await request(app).post(`/invitations/${token}/accept`).set("Authorization", bearer(admin));
    await request(app)
      .patch(`/workspaces/${workspaceId}/members/${admin.auth.user.id}`)
      .set("Authorization", bearer(owner))
      .send({ role: "admin" });
    await request(app)
      .post(`/workspaces/${workspaceId}/attachments`)
      .set("Authorization", bearer(owner))
      .attach("file", Buffer.from("notes"), "notes.txt");
    const stored = () => [...objects.objects.keys()].filter((key) => key.includes(workspaceId));
    expect(stored()).toHaveLength(1);

    const remove = (user: SignedUpUser, name: string) =>
      request(app)
        .delete(`/workspaces/${workspaceId}`)
        .set("Authorization", bearer(user))
        .send({ name });
    expect((await remove(admin, "Old project")).status).toBe(403);
    const wrongName = await remove(owner, "old project");
    expect(wrongName.status).toBe(400);
    expect(wrongName.body.error.code).toBe("name_mismatch");

    expect((await remove(owner, "Old project")).status).toBe(204);
    expect(stored()).toHaveLength(0);
    for (const user of [owner, admin]) {
      const list = await request(app).get("/workspaces").set("Authorization", bearer(user));
      expect(list.body.workspaces.map((w: { id: string }) => w.id)).not.toContain(workspaceId);
    }
    const audit = await connect(inject("testDatabaseOwnerUrl")).db.execute(
      sql`select action from audit_events where target = ${`workspace:${workspaceId}`}`,
    );
    expect(audit.rows).toEqual([{ action: "workspace.deleted" }]);
  });

  it("never deletes a personal workspace", async () => {
    const user = await signUp(app);
    const workspaceId = await personalWorkspaceId(user);
    const res = await request(app)
      .delete(`/workspaces/${workspaceId}`)
      .set("Authorization", bearer(user))
      .send({ name: "Ada's workspace" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("personal_workspace");
  });
});
