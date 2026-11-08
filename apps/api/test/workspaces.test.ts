import { randomUUID } from "node:crypto";
import { workspaceMembers, workspaces } from "@tessel/db";
import { sql } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { inject } from "vitest";
import { bearer, connect, createTestApp, signUp, type SignedUpUser } from "./helpers";

const app = createTestApp();

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
});
