import { createLiveModelRegistry, readModelsConfig } from "@tessel/ai";
import {
  adminModelsResponseSchema,
  adminOverviewSchema,
  adminUsageResponseSchema,
  adminUserDetailSchema,
  adminUserListResponseSchema,
} from "@tessel/contracts";
import { aiModelConfig, users } from "@tessel/db";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { totpCode, totpStep } from "../src/modules/auth/totp";
import {
  bearer,
  connect,
  createTestAi,
  createTestApp,
  signUp,
  TEST_PASSWORD,
  type SignedUpUser,
} from "./helpers";

const models = createLiveModelRegistry(readModelsConfig());
const app = createTestApp({ models, ai: createTestAi({ registry: models }) });
const db = connect().db;

afterAll(async () => {
  // Other test files read the bundled registry.
  await db.delete(aiModelConfig);
});

async function makeAdmin(user: SignedUpUser) {
  await db.update(users).set({ role: "admin" }).where(eq(users.email, user.email));
}

async function admin() {
  const user = await signUp(app, { name: "Admin Ada" });
  await makeAdmin(user);
  return user;
}

describe("admin access", () => {
  it("is refused to everyone but admins, checked on every request", async () => {
    const user = await signUp(app);
    const res = await request(app).get("/admin/overview").set("Authorization", bearer(user));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("admin_only");
    expect((await request(app).get("/admin/overview")).status).toBe(401);

    // Takes effect at once, without a new access token.
    await makeAdmin(user);
    expect(
      (await request(app).get("/admin/overview").set("Authorization", bearer(user))).status,
    ).toBe(200);
    await db.update(users).set({ role: "user" }).where(eq(users.id, user.auth.user.id));
    expect(
      (await request(app).get("/admin/overview").set("Authorization", bearer(user))).status,
    ).toBe(403);
  });

  it("can require two-step sign-in", async () => {
    const strict = createTestApp({ config: { adminRequireTwoFactor: true } });
    const user = await signUp(strict);
    await makeAdmin(user);
    const blocked = await request(strict).get("/admin/overview").set("Authorization", bearer(user));
    expect(blocked.body.error.code).toBe("admin_two_factor_required");

    const setup = await request(strict)
      .post("/users/me/two-factor/setup")
      .set("Authorization", bearer(user));
    await request(strict)
      .post("/users/me/two-factor/enable")
      .set("Authorization", bearer(user))
      .send({ code: totpCode(setup.body.secret, totpStep(new Date())) });
    expect(
      (await request(strict).get("/admin/overview").set("Authorization", bearer(user))).status,
    ).toBe(200);
  });

  it("isn't open to personal access tokens, even an admin's", async () => {
    const user = await admin();
    const workspace = (await request(app).get("/workspaces").set("Authorization", bearer(user)))
      .body.workspaces[0].id as string;
    const token = await request(app)
      .post(`/workspaces/${workspace}/access-tokens`)
      .set("Authorization", bearer(user))
      .send({ name: "script" });
    const res = await request(app)
      .get("/admin/overview")
      .set("Authorization", `Bearer ${token.body.token}`);
    expect(res.status).toBe(403);
  });
});

describe("admin users", () => {
  it("shows an overview and finds users by email or name", async () => {
    const me = await admin();
    const overview = adminOverviewSchema.parse(
      (await request(app).get("/admin/overview").set("Authorization", bearer(me))).body,
    );
    expect(overview.users).toBeGreaterThan(0);

    const target = await signUp(app, { name: "Findable Fiona" });
    const byName = await request(app)
      .get("/admin/users")
      .query({ query: "findable fiona" })
      .set("Authorization", bearer(me));
    const list = adminUserListResponseSchema.parse(byName.body);
    expect(list.users.map((user) => user.email)).toContain(target.email);

    const detail = await request(app)
      .get(`/admin/users/${target.auth.user.id}`)
      .set("Authorization", bearer(me));
    expect(adminUserDetailSchema.parse(detail.body)).toMatchObject({
      name: "Findable Fiona",
      hasPassword: true,
      activeSessions: 1,
      workspaces: [
        { name: "Findable's workspace", role: "owner", isPersonal: true, memberCount: 1 },
      ],
    });
  });

  it("pages through users", async () => {
    const me = await admin();
    await signUp(app);
    const first = await request(app).get("/admin/users?limit=1").set("Authorization", bearer(me));
    expect(first.body.users).toHaveLength(1);
    const second = await request(app)
      .get("/admin/users")
      .query({ limit: 1, cursor: first.body.nextCursor })
      .set("Authorization", bearer(me));
    expect(second.body.users[0].id).not.toBe(first.body.users[0].id);
  });

  it("suspends a user: they're signed out and can't sign in or use tokens", async () => {
    const me = await admin();
    const target = await signUp(app);
    const workspace = (await request(app).get("/workspaces").set("Authorization", bearer(target)))
      .body.workspaces[0].id as string;
    const token = await request(app)
      .post(`/workspaces/${workspace}/access-tokens`)
      .set("Authorization", bearer(target))
      .send({ name: "laptop" });

    const res = await request(app)
      .patch(`/admin/users/${target.auth.user.id}`)
      .set("Authorization", bearer(me))
      .send({ suspended: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ suspended: true, activeSessions: 0 });

    const login = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: TEST_PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("account_suspended");
    const refresh = await request(app)
      .post("/auth/refresh")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", target.refreshCookie);
    expect(refresh.status).toBe(401);
    const withToken = await request(app)
      .get(`/workspaces/${workspace}/documents`)
      .set("Authorization", `Bearer ${token.body.token}`);
    expect(withToken.status).toBe(401);

    await request(app)
      .patch(`/admin/users/${target.auth.user.id}`)
      .set("Authorization", bearer(me))
      .send({ suspended: false });
    const again = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: TEST_PASSWORD });
    expect(again.status).toBe(200);
  });

  it("makes and removes admins, but never changes the acting admin", async () => {
    const me = await admin();
    const target = await signUp(app);
    const promoted = await request(app)
      .patch(`/admin/users/${target.auth.user.id}`)
      .set("Authorization", bearer(me))
      .send({ role: "admin" });
    expect(promoted.body.role).toBe("admin");
    const self = await request(app)
      .patch(`/admin/users/${me.auth.user.id}`)
      .set("Authorization", bearer(me))
      .send({ suspended: true });
    expect(self.body.error.code).toBe("cannot_change_self");
  });

  it("signs a user out everywhere", async () => {
    const me = await admin();
    const target = await signUp(app);
    const res = await request(app)
      .post(`/admin/users/${target.auth.user.id}/sign-out`)
      .set("Authorization", bearer(me));
    expect(res.status).toBe(204);
    const refresh = await request(app)
      .post("/auth/refresh")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", target.refreshCookie);
    expect(refresh.status).toBe(401);
  });
});

describe("admin model registry", () => {
  it("edits models, which the API uses straight away and saves", async () => {
    const me = await admin();
    const current = adminModelsResponseSchema.parse(
      (await request(app).get("/admin/models").set("Authorization", bearer(me))).body,
    );
    const target = current.models.find(
      (model) => model.kind === "chat" && model.selectable && model.id !== current.defaults.chat,
    )!;
    const edited = {
      defaults: current.defaults,
      models: current.models.map((model) =>
        model.id === target.id ? { ...model, enabled: false, label: "Turned off" } : model,
      ),
    };
    const saved = await request(app)
      .put("/admin/models")
      .set("Authorization", bearer(me))
      .send(edited);
    expect(saved.status).toBe(200);
    expect(saved.body.source).toBe("saved");

    // The model picker no longer offers it.
    const picker = await request(app).get("/models").set("Authorization", bearer(me));
    expect(picker.body.models.map((model: { id: string }) => model.id)).not.toContain(target.id);
    const [row] = await db.select().from(aiModelConfig);
    expect(row?.updatedBy).toBe(me.auth.user.id);

    // Put it back for other tests.
    await request(app).put("/admin/models").set("Authorization", bearer(me)).send({
      defaults: current.defaults,
      models: current.models,
    });
  });

  it("refuses an invalid registry, keeping the current one", async () => {
    const me = await admin();
    const current = (await request(app).get("/admin/models").set("Authorization", bearer(me))).body;
    const broken = {
      defaults: current.defaults,
      models: current.models.map((model: { id: string; enabled: boolean }) =>
        model.id === current.defaults.chat ? { ...model, enabled: false } : model,
      ),
    };
    const res = await request(app)
      .put("/admin/models")
      .set("Authorization", bearer(me))
      .send(broken);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_models");
    expect(models.forRole("chat").id).toBe(current.defaults.chat);
  });

  it("won't change the embedding model", async () => {
    const me = await admin();
    const current = (await request(app).get("/admin/models").set("Authorization", bearer(me))).body;
    const res = await request(app)
      .put("/admin/models")
      .set("Authorization", bearer(me))
      .send({
        defaults: current.defaults,
        models: current.models.map((model: { id: string; dimensions?: number }) =>
          model.id === current.defaults.embedding ? { ...model, dimensions: 42 } : model,
        ),
      });
    expect(res.body.error.code).toBe("embedding_model_fixed");
  });
});

describe("admin usage and audit log", () => {
  it("summarises usage and lists audit events across workspaces", async () => {
    const me = await admin();
    const target = await signUp(app);
    await request(app)
      .patch(`/admin/users/${target.auth.user.id}`)
      .set("Authorization", bearer(me))
      .send({ suspended: true });

    const usage = await request(app).get("/admin/usage?days=7").set("Authorization", bearer(me));
    expect(adminUsageResponseSchema.parse(usage.body).days).toBeInstanceOf(Array);

    const log = await request(app)
      .get("/admin/audit-log")
      .query({ action: "admin.", actorId: me.auth.user.id })
      .set("Authorization", bearer(me));
    expect(log.body.events[0]).toMatchObject({
      action: "admin.user_suspended",
      target: `user:${target.auth.user.id}`,
      actor: { id: me.auth.user.id },
    });
  });
});
