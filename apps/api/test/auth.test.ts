import { authResponseSchema } from "@tessel/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  bearer,
  createTestApp,
  emailLinkToken,
  resetLinkToken,
  testOutbox,
  waitForEmailLink,
  findRefreshCookie,
  signUp,
  TEST_PASSWORD,
  uniqueEmail,
  WEB_ORIGIN,
} from "./helpers";

describe("signup", () => {
  const app = createTestApp();

  it("creates the account and signs in at once, with a secure session", async () => {
    const email = `grace.hopper-${uniqueEmail()}`;
    const res = await request(app)
      .post("/auth/signup")
      .send({ email: `  ${email.toUpperCase()} `, password: TEST_PASSWORD });
    expect(res.status).toBe(201);
    const body = authResponseSchema.parse(res.body);
    expect(body.user).toMatchObject({
      email,
      // A starting name from the email, until it's changed in Settings.
      name: expect.stringMatching(/^Grace Hopper/),
      role: "user",
      emailVerified: false,
      twoFactorEnabled: false,
      hasPassword: true,
    });
    expect(body).not.toHaveProperty("refreshToken");
    expect(JSON.stringify(body)).not.toContain('password"');

    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((value) =>
      value.startsWith("tessel_rt="),
    );
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/auth/);

    // The password works for logging in later.
    const login = await request(app).post("/auth/login").send({ email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
  });

  it("emails a link that confirms the address, once, for that account only", async () => {
    const user = await signUp(app, { confirmEmail: false });
    const other = await signUp(app, { confirmEmail: false });
    const token = await waitForEmailLink(user.email);
    expect(testOutbox.latest(user.email)?.subject).toBe("Confirm your email for Tessel");
    const verify = (who: typeof user) =>
      request(app).post("/users/me/email/verify").set("Authorization", bearer(who)).send({ token });

    // Someone else signed in can't use it.
    const wrong = await verify(other);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("invalid_email_link");

    const res = await verify(user);
    expect(res.status).toBe(200);
    expect(res.body.emailVerified).toBe(true);
    expect((await verify(user)).status).toBe(400);
  });

  it("sends a new link on request; only the newest works", async () => {
    const user = await signUp(app, { confirmEmail: false });
    const first = await waitForEmailLink(user.email);
    const resend = await request(app)
      .post("/users/me/email/verification")
      .set("Authorization", bearer(user));
    expect(resend.status).toBe(202);
    const second = emailLinkToken(user.email);
    expect(second).not.toBe(first);
    const verify = (token: string) =>
      request(app)
        .post("/users/me/email/verify")
        .set("Authorization", bearer(user))
        .send({ token });
    expect((await verify(first)).status).toBe(400);
    expect((await verify(second)).status).toBe(200);
  });

  it("creates a personal workspace owned by the new user", async () => {
    const user = await signUp(app, { name: "Linus Torvalds" });
    const res = await request(app).get("/workspaces").set("Authorization", bearer(user));
    expect(res.body.workspaces).toEqual([
      expect.objectContaining({ name: "Linus's workspace", isPersonal: true, role: "owner" }),
    ]);
  });

  it("says when an email already has an account", async () => {
    const { email } = await signUp(app);
    const taken = await request(app)
      .post("/auth/signup")
      .send({ email: email.toUpperCase(), password: TEST_PASSWORD });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("email_taken");
    expect(findRefreshCookie(taken.headers["set-cookie"])).toBeUndefined();
  });

  it("rejects a short password", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ email: uniqueEmail(), password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ path: "password" });
  });

  it("lets the email's owner take over an unconfirmed account with a password reset", async () => {
    // Someone signs up with an address they don't own, and makes an access token.
    const squatter = await signUp(app, { confirmEmail: false });
    const workspace = (await request(app).get("/workspaces").set("Authorization", bearer(squatter)))
      .body.workspaces[0].id as string;
    const pat = await request(app)
      .post(`/workspaces/${workspace}/access-tokens`)
      .set("Authorization", bearer(squatter))
      .send({ name: "backdoor" });
    expect(pat.status).toBe(201);

    // The real owner resets the password from their inbox.
    await request(app).post("/auth/password/forgot").send({ email: squatter.email });
    const token = await resetLinkToken(squatter.email);
    const NEW_PASSWORD = "the owner's own password";
    expect(
      (await request(app).post("/auth/password/reset").send({ token, password: NEW_PASSWORD }))
        .status,
    ).toBe(204);

    // Every way in the squatter set up is gone.
    expect(
      (await request(app).post("/auth/refresh").set("Cookie", squatter.refreshCookie)).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get(`/workspaces/${workspace}`)
          .set("Authorization", `Bearer ${pat.body.token}`)
      ).status,
    ).toBe(401);
    const login = await request(app)
      .post("/auth/login")
      .send({ email: squatter.email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.emailVerified).toBe(true);
  });
});

describe("login", () => {
  const app = createTestApp();

  it("returns a working access token for correct credentials", async () => {
    const { email } = await signUp(app);
    const res = await request(app).post("/auth/login").send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(findRefreshCookie(res.headers["set-cookie"])).toBeDefined();

    const me = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const { email } = await signUp(app);
    const wrongPassword = await request(app)
      .post("/auth/login")
      .send({ email, password: "wrong password!" });
    const unknownEmail = await request(app)
      .post("/auth/login")
      .send({ email: uniqueEmail("nobody"), password: TEST_PASSWORD });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: "invalid_credentials",
        message: "Email or password is incorrect",
      });
    }
  });

  it("is rate limited per IP and email", async () => {
    const limited = createTestApp({
      config: { rateLimits: { login: { windowMs: 60_000, limit: 2 } } },
    });
    const { email } = await signUp(limited);
    const attempt = (target: string) =>
      request(limited).post("/auth/login").send({ email: target, password: "wrong password!" });

    await attempt(email);
    await attempt(email);
    expect((await attempt(email)).status).toBe(429);
    // A different email from the same IP has its own budget.
    expect((await attempt(uniqueEmail())).status).toBe(401);
  });

  it("rejects requests from origins that are not allowed", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: uniqueEmail(), password: TEST_PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe("access tokens", () => {
  const app = createTestApp();

  it("are required on protected routes", async () => {
    const res = await request(app).get("/users/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("are rejected when tampered with or signed with another secret", async () => {
    const user = await signUp(app);
    const tampered = `${user.auth.accessToken.slice(0, -2)}xx`;
    const res = await request(app).get("/users/me").set("Authorization", `Bearer ${tampered}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_token");

    const otherApp = createTestApp({
      config: { auth: { accessTokenSecret: "a-completely-different-secret-of-32-plus-chars" } },
    });
    const foreign = await request(otherApp).get("/users/me").set("Authorization", bearer(user));
    expect(foreign.status).toBe(401);
  });
});

describe("refresh", () => {
  const app = createTestApp();

  it("rotates the refresh token and returns a new access token", async () => {
    const user = await signUp(app);
    const res = await request(app).post("/auth/refresh").set("Cookie", user.refreshCookie);
    expect(res.status).toBe(200);
    expect(authResponseSchema.parse(res.body).user.id).toBe(user.auth.user.id);

    const rotated = findRefreshCookie(res.headers["set-cookie"]);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(user.refreshCookie);
  });

  it("treats an immediate second use as a race, not theft", async () => {
    const user = await signUp(app);
    const first = await request(app).post("/auth/refresh").set("Cookie", user.refreshCookie);
    const second = await request(app).post("/auth/refresh").set("Cookie", user.refreshCookie);
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe("refresh_token_rotated");

    // The session is still alive: the newest token keeps working.
    const newest = findRefreshCookie(first.headers["set-cookie"])!;
    expect((await request(app).post("/auth/refresh").set("Cookie", newest)).status).toBe(200);
  });

  it("revokes the whole session when an old token is reused after the grace period", async () => {
    const strict = createTestApp({ config: { auth: { refreshRotationGraceMs: 0 } } });
    const user = await signUp(strict);
    const first = await request(strict).post("/auth/refresh").set("Cookie", user.refreshCookie);
    const newest = findRefreshCookie(first.headers["set-cookie"])!;

    const replay = await request(strict).post("/auth/refresh").set("Cookie", user.refreshCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("invalid_refresh_token");
    expect(replay.headers["set-cookie"]?.toString()).toMatch(/tessel_rt=;/);

    // The attacker's copy and the legitimate newest token are both dead now.
    const afterReplay = await request(strict).post("/auth/refresh").set("Cookie", newest);
    expect(afterReplay.status).toBe(401);
  });

  it("requires the cookie", async () => {
    const res = await request(app).post("/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("missing_refresh_token");
  });

  it("rejects a forged cookie", async () => {
    const res = await request(app).post("/auth/refresh").set("Cookie", "tessel_rt=forged-token");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_refresh_token");
  });

  it("accepts the web origin and rejects other origins", async () => {
    const user = await signUp(app);
    const evil = await request(app)
      .post("/auth/refresh")
      .set("Origin", "https://evil.example")
      .set("Cookie", user.refreshCookie);
    expect(evil.status).toBe(403);

    const ok = await request(app)
      .post("/auth/refresh")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", user.refreshCookie);
    expect(ok.status).toBe(200);
  });
});

describe("logout", () => {
  const app = createTestApp();

  it("ends the session and clears the cookie", async () => {
    const user = await signUp(app);
    const res = await request(app).post("/auth/logout").set("Cookie", user.refreshCookie);
    expect(res.status).toBe(204);
    expect(res.headers["set-cookie"]?.toString()).toMatch(/tessel_rt=;/);

    const refresh = await request(app).post("/auth/refresh").set("Cookie", user.refreshCookie);
    expect(refresh.status).toBe(401);
  });

  it("succeeds even without a session", async () => {
    expect((await request(app).post("/auth/logout")).status).toBe(204);
  });
});
