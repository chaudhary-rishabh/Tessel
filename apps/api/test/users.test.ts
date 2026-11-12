import { publicUserSchema } from "@tessel/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { bearer, createTestApp, findRefreshCookie, signUp, TEST_PASSWORD } from "./helpers";

const NEW_PASSWORD = "an even longer passphrase";

describe("GET /users/me", () => {
  const app = createTestApp();

  it("returns the signed-in user without private fields", async () => {
    const user = await signUp(app, { name: "Margaret Hamilton" });
    const res = await request(app).get("/users/me").set("Authorization", bearer(user));
    expect(res.status).toBe(200);
    expect(publicUserSchema.strict().parse(res.body)).toMatchObject({
      id: user.auth.user.id,
      name: "Margaret Hamilton",
    });
  });
});

describe("PATCH /users/me", () => {
  const app = createTestApp();

  it("changes the name, and refuses an empty one", async () => {
    const user = await signUp(app);
    const res = await request(app)
      .patch("/users/me")
      .set("Authorization", bearer(user))
      .send({ name: "  Katherine Johnson " });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Katherine Johnson");
    const empty = await request(app)
      .patch("/users/me")
      .set("Authorization", bearer(user))
      .send({ name: "  " });
    expect(empty.status).toBe(400);
  });
});

describe("POST /users/me/password", () => {
  const app = createTestApp();

  it("changes the password and ends every other session", async () => {
    const user = await signUp(app);
    const otherDevice = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    const otherDeviceCookie = findRefreshCookie(otherDevice.headers["set-cookie"])!;

    const res = await request(app)
      .post("/users/me/password")
      .set("Authorization", bearer(user))
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    const freshCookie = findRefreshCookie(res.headers["set-cookie"]);
    expect(freshCookie).toBeDefined();

    // Old sessions are gone; the session from this request continues.
    for (const cookie of [user.refreshCookie, otherDeviceCookie]) {
      expect((await request(app).post("/auth/refresh").set("Cookie", cookie)).status).toBe(401);
    }
    expect((await request(app).post("/auth/refresh").set("Cookie", freshCookie!)).status).toBe(200);

    // Only the new password works.
    const oldLogin = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    const newLogin = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: NEW_PASSWORD });
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });

  it("requires the correct current password", async () => {
    const user = await signUp(app);
    const res = await request(app)
      .post("/users/me/password")
      .set("Authorization", bearer(user))
      .send({ currentPassword: "not my password", newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_current_password");
  });

  it("enforces password rules on the new password", async () => {
    const user = await signUp(app);
    const res = await request(app)
      .post("/users/me/password")
      .set("Authorization", bearer(user))
      .send({ currentPassword: TEST_PASSWORD, newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/users/me/password")
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });
});
