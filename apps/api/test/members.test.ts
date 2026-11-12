import {
  auditLogResponseSchema,
  invitationPreviewSchema,
  memberListResponseSchema,
} from "@tessel/contracts";
import { auditEvents } from "@tessel/db";
import { desc, eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  bearer,
  connect,
  createTestApp,
  signUp,
  testOutbox,
  uniqueEmail,
  type SignedUpUser,
} from "./helpers";

const app = createTestApp();

async function teamWorkspace(owner: SignedUpUser, name = "Research") {
  const res = await request(app)
    .post("/workspaces")
    .set("Authorization", bearer(owner))
    .send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function invitationToken(email: string): string {
  const token = /\/invite\/([\w-]+)/.exec(testOutbox.latest(email)?.text ?? "")?.[1];
  if (!token) throw new Error(`No invitation was emailed to ${email}`);
  return token;
}

async function invite(
  by: SignedUpUser,
  workspaceId: string,
  email: string,
  role: "admin" | "member" = "member",
) {
  return request(app)
    .post(`/workspaces/${workspaceId}/invitations`)
    .set("Authorization", bearer(by))
    .send({ email, role });
}

/** A new account joins the workspace through an emailed invitation. */
async function join(owner: SignedUpUser, workspaceId: string, role: "admin" | "member" = "member") {
  const email = uniqueEmail("teammate");
  expect((await invite(owner, workspaceId, email, role)).status).toBe(201);
  const token = invitationToken(email);
  const user = await signUp(app, { email, name: "Teammate" });
  const res = await request(app)
    .post(`/invitations/${token}/accept`)
    .set("Authorization", bearer(user));
  expect(res.status).toBe(200);
  return user;
}

async function members(user: SignedUpUser, workspaceId: string) {
  const res = await request(app)
    .get(`/workspaces/${workspaceId}/members`)
    .set("Authorization", bearer(user));
  return memberListResponseSchema.parse(res.body).members;
}

describe("invitations", () => {
  it("emails a link that shows the workspace and joins it on accepting", async () => {
    const owner = await signUp(app, { name: "Grace Hopper" });
    const workspaceId = await teamWorkspace(owner);
    const email = uniqueEmail("invitee");
    const sent = await invite(owner, workspaceId, email.toUpperCase());
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ email, role: "member", invitedBy: "Grace Hopper" });
    expect(testOutbox.latest(email)?.subject).toBe(
      "Grace Hopper invited you to Research on Tessel",
    );

    const token = invitationToken(email);
    const preview = await request(app).get(`/invitations/${token}`);
    expect(invitationPreviewSchema.parse(preview.body)).toMatchObject({
      workspaceName: "Research",
      inviterName: "Grace Hopper",
      email,
      role: "member",
    });

    const invitee = await signUp(app, { email, name: "Ada" });
    const accepted = await request(app)
      .post(`/invitations/${token}/accept`)
      .set("Authorization", bearer(invitee));
    expect(accepted.status).toBe(200);
    expect(accepted.body.workspace).toMatchObject({
      id: workspaceId,
      name: "Research",
      role: "member",
    });
    expect((await members(owner, workspaceId)).map((member) => member.email)).toContain(email);

    // Used once.
    expect((await request(app).get(`/invitations/${token}`)).status).toBe(404);
  });

  it("can only be accepted by the account it was sent to", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner);
    const email = uniqueEmail("intended");
    await invite(owner, workspaceId, email);
    const someoneElse = await signUp(app);
    const res = await request(app)
      .post(`/invitations/${invitationToken(email)}/accept`)
      .set("Authorization", bearer(someoneElse));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_invitation");
  });

  it("asks for a confirmed email before joining", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner);
    const email = uniqueEmail("unconfirmed");
    await invite(owner, workspaceId, email);
    const token = invitationToken(email);
    const invitee = await signUp(app, { email, confirmEmail: false });
    const res = await request(app)
      .post(`/invitations/${token}/accept`)
      .set("Authorization", bearer(invitee));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("email_unconfirmed");
  });

  it("isn't possible for personal workspaces, existing members, or owners", async () => {
    const owner = await signUp(app);
    const personal = (await request(app).get("/workspaces").set("Authorization", bearer(owner)))
      .body.workspaces[0].id as string;
    expect((await invite(owner, personal, uniqueEmail())).body.error.code).toBe(
      "personal_workspace",
    );

    const workspaceId = await teamWorkspace(owner);
    const teammate = await join(owner, workspaceId);
    expect((await invite(owner, workspaceId, teammate.email)).body.error.code).toBe(
      "already_member",
    );

    const asOwner = await request(app)
      .post(`/workspaces/${workspaceId}/invitations`)
      .set("Authorization", bearer(owner))
      .send({ email: uniqueEmail(), role: "owner" });
    expect(asOwner.status).toBe(400);
  });

  it("are listed and revoked by managers only, and a new one replaces the old", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner);
    const member = await join(owner, workspaceId);
    const email = uniqueEmail("pending");
    await invite(owner, workspaceId, email);
    const first = invitationToken(email);
    await invite(owner, workspaceId, email);

    const list = await request(app)
      .get(`/workspaces/${workspaceId}/invitations`)
      .set("Authorization", bearer(owner));
    expect(
      list.body.invitations.filter((item: { email: string }) => item.email === email),
    ).toHaveLength(1);
    expect((await request(app).get(`/invitations/${first}`)).status).toBe(404);

    expect(
      (
        await request(app)
          .get(`/workspaces/${workspaceId}/invitations`)
          .set("Authorization", bearer(member))
      ).status,
    ).toBe(403);
    expect((await invite(member, workspaceId, uniqueEmail())).status).toBe(403);

    const id = list.body.invitations[0].id as string;
    const revoked = await request(app)
      .delete(`/workspaces/${workspaceId}/invitations/${id}`)
      .set("Authorization", bearer(owner));
    expect(revoked.status).toBe(204);
    expect((await request(app).get(`/invitations/${invitationToken(email)}`)).status).toBe(404);
  });

  it("only lets the owner invite admins", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner);
    const admin = await join(owner, workspaceId, "admin");
    expect((await invite(admin, workspaceId, uniqueEmail(), "admin")).status).toBe(403);
    expect((await invite(admin, workspaceId, uniqueEmail(), "member")).status).toBe(201);
  });
});

describe("members", () => {
  it("lists everyone, owner first", async () => {
    const owner = await signUp(app, { name: "Zed Owner" });
    const workspaceId = await teamWorkspace(owner);
    const member = await join(owner, workspaceId);
    const list = await members(member, workspaceId);
    expect(list.map((item) => item.role)).toEqual(["owner", "member"]);
    const outsider = await signUp(app);
    expect(
      (
        await request(app)
          .get(`/workspaces/${workspaceId}/members`)
          .set("Authorization", bearer(outsider))
      ).status,
    ).toBe(404);
  });

  it("lets the owner change roles, and nobody else", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner);
    const admin = await join(owner, workspaceId, "admin");
    const member = await join(owner, workspaceId);
    const promote = (by: SignedUpUser, userId: string, role: string) =>
      request(app)
        .patch(`/workspaces/${workspaceId}/members/${userId}`)
        .set("Authorization", bearer(by))
        .send({ role });
    expect((await promote(admin, member.auth.user.id, "admin")).status).toBe(403);
    const res = await promote(owner, member.auth.user.id, "admin");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("admin");
    expect((await promote(owner, owner.auth.user.id, "member")).body.error.code).toBe("owner_role");
  });

  it("removes members: admins remove members, the owner removes anyone", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner);
    const admin = await join(owner, workspaceId, "admin");
    const member = await join(owner, workspaceId);
    const otherAdmin = await join(owner, workspaceId, "admin");
    const remove = (by: SignedUpUser, userId: string) =>
      request(app)
        .delete(`/workspaces/${workspaceId}/members/${userId}`)
        .set("Authorization", bearer(by));

    expect((await remove(member, admin.auth.user.id)).status).toBe(403);
    expect((await remove(admin, otherAdmin.auth.user.id)).status).toBe(403);
    expect((await remove(admin, owner.auth.user.id)).body.error.code).toBe("owner_cannot_leave");
    expect((await remove(admin, member.auth.user.id)).status).toBe(204);
    expect((await remove(owner, otherAdmin.auth.user.id)).status).toBe(204);

    // A removed member loses access straight away.
    expect(
      (await request(app).get(`/workspaces/${workspaceId}`).set("Authorization", bearer(member)))
        .status,
    ).toBe(404);
  });

  it("lets members leave, but not the owner until they hand over", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner);
    const member = await join(owner, workspaceId);
    const leave = (user: SignedUpUser) =>
      request(app)
        .delete(`/workspaces/${workspaceId}/members/${user.auth.user.id}`)
        .set("Authorization", bearer(user));
    expect((await leave(owner)).body.error.code).toBe("owner_cannot_leave");

    const transfer = await request(app)
      .post(`/workspaces/${workspaceId}/transfer`)
      .set("Authorization", bearer(owner))
      .send({ userId: member.auth.user.id });
    expect(transfer.status).toBe(204);
    const roles = Object.fromEntries(
      (await members(member, workspaceId)).map((item) => [item.userId, item.role]),
    );
    expect(roles).toEqual({ [member.auth.user.id]: "owner", [owner.auth.user.id]: "admin" });

    expect((await leave(owner)).status).toBe(204);
  });

  it("makes personal access tokens stop working for removed members", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner);
    const member = await join(owner, workspaceId);
    const token = await request(app)
      .post(`/workspaces/${workspaceId}/access-tokens`)
      .set("Authorization", bearer(member))
      .send({ name: "laptop" });
    await request(app)
      .delete(`/workspaces/${workspaceId}/members/${member.auth.user.id}`)
      .set("Authorization", bearer(owner));
    const res = await request(app)
      .get(`/workspaces/${workspaceId}/documents`)
      .set("Authorization", `Bearer ${token.body.token}`);
    expect(res.status).toBe(401);
  });
});

describe("audit log", () => {
  it("records membership changes for owners and admins to read", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner);
    const member = await join(owner, workspaceId);
    await request(app)
      .patch(`/workspaces/${workspaceId}/members/${member.auth.user.id}`)
      .set("Authorization", bearer(owner))
      .send({ role: "admin" });
    await request(app)
      .patch(`/workspaces/${workspaceId}`)
      .set("Authorization", bearer(owner))
      .send({ name: "Research and Development" });

    const res = await request(app)
      .get(`/workspaces/${workspaceId}/audit-log`)
      .set("Authorization", bearer(owner));
    const { events } = auditLogResponseSchema.parse(res.body);
    expect(events.map((event) => event.action)).toEqual([
      "workspace.renamed",
      "member.role_changed",
      "member.joined",
      "member.invited",
      "workspace.created",
    ]);
    expect(events[1]).toMatchObject({
      actor: { id: owner.auth.user.id, email: owner.email },
      target: `user:${member.auth.user.id}`,
      metadata: { from: "member", to: "admin" },
    });

    const another = await signUp(app);
    const outsider = await request(app)
      .get(`/workspaces/${workspaceId}/audit-log`)
      .set("Authorization", bearer(another));
    expect(outsider.status).toBe(404);
  });

  it("records sign-ups, sign-ins, and security changes", async () => {
    const user = await signUp(app);
    await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: "correct horse battery" });
    await request(app)
      .post("/users/me/password")
      .set("Authorization", bearer(user))
      .send({ currentPassword: "correct horse battery", newPassword: "an even longer passphrase" });
    const rows = await connect()
      .db.select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, user.auth.user.id))
      .orderBy(desc(auditEvents.createdAt));
    expect(rows.map((row) => row.action)).toEqual([
      "auth.password_changed",
      "auth.signed_in",
      "auth.email_verified",
      "auth.signed_up",
    ]);
    expect(rows[1]).toMatchObject({
      metadata: { method: "password" },
      ipAddress: expect.any(String),
    });
  });

  it("pages with before", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner);
    for (const name of ["One", "Two", "Three"]) {
      await request(app)
        .patch(`/workspaces/${workspaceId}`)
        .set("Authorization", bearer(owner))
        .send({ name });
    }
    const first = await request(app)
      .get(`/workspaces/${workspaceId}/audit-log?limit=2`)
      .set("Authorization", bearer(owner));
    expect(first.body.events).toHaveLength(2);
    expect(first.body.nextBefore).not.toBeNull();
    // The response matches the contract the web app parses it with.
    expect(auditLogResponseSchema.safeParse(first.body).success).toBe(true);
    const second = await request(app)
      .get(`/workspaces/${workspaceId}/audit-log`)
      .query({ limit: 2, before: first.body.nextBefore })
      .set("Authorization", bearer(owner));
    expect(second.body.events.map((event: { action: string }) => event.action)).toEqual([
      "workspace.renamed",
      "workspace.created",
    ]);
    expect(second.body.nextBefore).toBeNull();
  });
});

describe("leaving a workspace", () => {
  it("revokes the person's access tokens there, so rejoining doesn't bring them back", async () => {
    const owner = await signUp(app);
    const workspaceId = await teamWorkspace(owner, "Tokens");
    const member = await join(owner, workspaceId);
    const created = await request(app)
      .post(`/workspaces/${workspaceId}/access-tokens`)
      .set("Authorization", bearer(member))
      .send({ name: "Laptop" });
    expect(created.status).toBe(201);
    const token = created.body.token as string;
    const useToken = () =>
      request(app)
        .get(`/workspaces/${workspaceId}/documents`)
        .set("Authorization", `Bearer ${token}`);
    expect((await useToken()).status).toBe(200);

    const removed = await request(app)
      .delete(`/workspaces/${workspaceId}/members/${member.auth.user.id}`)
      .set("Authorization", bearer(owner));
    expect(removed.status).toBe(204);
    expect((await useToken()).status).toBe(401);

    // Invited back: the old token still doesn't work.
    const email = member.email;
    await invite(owner, workspaceId, email);
    await request(app)
      .post(`/invitations/${invitationToken(email)}/accept`)
      .set("Authorization", bearer(member));
    expect((await members(owner, workspaceId)).map((m) => m.userId)).toContain(member.auth.user.id);
    expect((await useToken()).status).toBe(401);
  });
});
