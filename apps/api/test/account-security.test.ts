import { authResponseSchema, sessionListResponseSchema } from "@tessel/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { totpCode, totpStep } from "../src/modules/auth/totp";
import {
  bearer,
  createTestApp,
  findRefreshCookie,
  resetLinkToken,
  type SignedUpUser,
  signUp,
  TEST_PASSWORD,
  testOutbox,
  uniqueEmail,
  WEB_ORIGIN,
} from "./helpers";

const NEW_PASSWORD = "a much better passphrase";

const resetToken = resetLinkToken;

/** A code for a later 30-second window, so it isn't the one already used. */
function codeAt(secret: string, stepsAhead: number): string {
  return totpCode(secret, totpStep(new Date()) + stepsAhead);
}

describe("password reset", () => {
  const app = createTestApp();

  it("emails a one-time link that sets a new password and signs out everywhere", async () => {
    const user = await signUp(app);
    const forgot = await request(app).post("/auth/password/forgot").send({ email: user.email });
    expect(forgot.status).toBe(202);
    const token = await resetToken(user.email);
    expect(testOutbox.latest(user.email)?.text).toContain(`${WEB_ORIGIN}/reset-password?token=`);

    const reset = await request(app)
      .post("/auth/password/reset")
      .send({ token, password: NEW_PASSWORD });
    expect(reset.status).toBe(204);
    expect(testOutbox.latest(user.email)?.subject).toBe("Your Tessel password was changed");

    // The old session is gone, the old password is gone, the new one works.
    const refreshed = await request(app)
      .post("/auth/refresh")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", user.refreshCookie);
    expect(refreshed.status).toBe(401);
    const oldLogin = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);

    // The link works once.
    const again = await request(app)
      .post("/auth/password/reset")
      .send({ token, password: "yet another passphrase" });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("invalid_reset_link");
  });

  it("answers the same way for an unknown email and sends nothing", async () => {
    const email = uniqueEmail("nobody");
    const res = await request(app).post("/auth/password/forgot").send({ email });
    expect(res.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(testOutbox.latest(email)).toBeUndefined();
  });

  it("rejects a made-up token", async () => {
    const res = await request(app)
      .post("/auth/password/reset")
      .send({ token: "x".repeat(43), password: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  it("only honours the newest link", async () => {
    const user = await signUp(app);
    await request(app).post("/auth/password/forgot").send({ email: user.email });
    const first = await resetToken(user.email);
    await request(app).post("/auth/password/forgot").send({ email: user.email });
    const second = await resetToken(user.email, first);
    expect(
      (
        await request(app)
          .post("/auth/password/reset")
          .send({ token: first, password: NEW_PASSWORD })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/auth/password/reset")
          .send({ token: second, password: NEW_PASSWORD })
      ).status,
    ).toBe(204);
  });
});

describe("two-step sign-in", () => {
  const app = createTestApp();

  async function enable(user: SignedUpUser) {
    const setup = await request(app)
      .post("/users/me/two-factor/setup")
      .set("Authorization", bearer(user));
    expect(setup.status).toBe(200);
    expect(setup.body.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(setup.body.otpauthUrl).toContain("otpauth://totp/Tessel");
    const secret: string = setup.body.secret;
    const enabled = await request(app)
      .post("/users/me/two-factor/enable")
      .set("Authorization", bearer(user))
      .send({ code: codeAt(secret, 0) });
    expect(enabled.status).toBe(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    return { secret, recoveryCodes: enabled.body.recoveryCodes as string[] };
  }

  async function passwordStep(email: string) {
    const res = await request(app).post("/auth/login").send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "two_factor_required", challengeToken: expect.any(String) });
    expect(findRefreshCookie(res.headers["set-cookie"])).toBeUndefined();
    return res.body.challengeToken as string;
  }

  it("refuses to turn on without a correct code", async () => {
    const user = await signUp(app);
    await request(app).post("/users/me/two-factor/setup").set("Authorization", bearer(user));
    const res = await request(app)
      .post("/users/me/two-factor/enable")
      .set("Authorization", bearer(user))
      .send({ code: "000000" });
    expect(res.status).toBe(400);
    const me = await request(app).get("/users/me").set("Authorization", bearer(user));
    expect(me.body.twoFactorEnabled).toBe(false);
  });

  it("asks for an authenticator code after the password, and each code works once", async () => {
    const user = await signUp(app);
    const { secret } = await enable(user);
    expect(testOutbox.latest(user.email)?.subject).toBe("Two-step sign-in is on");
    const me = await request(app).get("/users/me").set("Authorization", bearer(user));
    expect(me.body.twoFactorEnabled).toBe(true);

    const challengeToken = await passwordStep(user.email);
    const wrong = await request(app)
      .post("/auth/login/two-factor")
      .send({ challengeToken, code: "000000" });
    expect(wrong.status).toBe(401);

    const code = codeAt(secret, 1);
    const res = await request(app).post("/auth/login/two-factor").send({ challengeToken, code });
    expect(res.status).toBe(200);
    authResponseSchema.parse(res.body);
    expect(findRefreshCookie(res.headers["set-cookie"])).toBeDefined();

    const replay = await request(app)
      .post("/auth/login/two-factor")
      .send({ challengeToken: await passwordStep(user.email), code });
    expect(replay.status).toBe(401);
  });

  it("rejects a forged challenge token", async () => {
    const res = await request(app)
      .post("/auth/login/two-factor")
      .send({ challengeToken: "not-a-token", code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("two_factor_expired");
  });

  it("doesn't let an access token stand in for the challenge", async () => {
    const user = await signUp(app);
    await enable(user);
    const res = await request(app)
      .post("/auth/login/two-factor")
      .send({ challengeToken: user.auth.accessToken, code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("two_factor_expired");
  });

  it("accepts each recovery code once", async () => {
    const user = await signUp(app);
    const { recoveryCodes } = await enable(user);
    const recoveryCode = recoveryCodes[0]!.toUpperCase();
    const first = await request(app)
      .post("/auth/login/two-factor")
      .send({ challengeToken: await passwordStep(user.email), recoveryCode });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post("/auth/login/two-factor")
      .send({ challengeToken: await passwordStep(user.email), recoveryCode });
    expect(second.status).toBe(401);
  });

  it("replaces recovery codes on request", async () => {
    const user = await signUp(app);
    const { secret, recoveryCodes } = await enable(user);
    const res = await request(app)
      .post("/users/me/two-factor/recovery-codes")
      .set("Authorization", bearer(user))
      .send({ code: codeAt(secret, 1) });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
    const old = await request(app)
      .post("/auth/login/two-factor")
      .send({ challengeToken: await passwordStep(user.email), recoveryCode: recoveryCodes[0] });
    expect(old.status).toBe(401);
  });

  it("turns off only with the password and a current code", async () => {
    const user = await signUp(app);
    const { secret } = await enable(user);
    const noPassword = await request(app)
      .post("/users/me/two-factor/disable")
      .set("Authorization", bearer(user))
      .send({ password: "wrong password!", code: codeAt(secret, 1) });
    expect(noPassword.status).toBe(400);

    const off = await request(app)
      .post("/users/me/two-factor/disable")
      .set("Authorization", bearer(user))
      .send({ password: TEST_PASSWORD, code: codeAt(secret, 1) });
    expect(off.status).toBe(204);
    expect(testOutbox.latest(user.email)?.subject).toBe("Two-step sign-in was turned off");

    const login = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    authResponseSchema.parse(login.body);
  });
});

describe("sessions", () => {
  const app = createTestApp();

  it("lists signed-in devices and signs one out", async () => {
    const user = await signUp(app);
    const other = await request(app)
      .post("/auth/login")
      .set("User-Agent", "Other device")
      .send({ email: user.email, password: TEST_PASSWORD });
    const otherCookie = findRefreshCookie(other.headers["set-cookie"])!;

    const list = await request(app)
      .get("/auth/sessions")
      .set("Origin", WEB_ORIGIN)
      .set("Authorization", bearer(user))
      .set("Cookie", user.refreshCookie);
    expect(list.status).toBe(200);
    const { sessions } = sessionListResponseSchema.parse(list.body);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    const target = sessions.find((session) => session.userAgent === "Other device")!;
    expect(target.current).toBe(false);

    const revoked = await request(app)
      .delete(`/auth/sessions/${target.id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Authorization", bearer(user));
    expect(revoked.status).toBe(204);
    const refreshed = await request(app)
      .post("/auth/refresh")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", otherCookie);
    expect(refreshed.status).toBe(401);
  });

  it("can't touch someone else's session", async () => {
    const mine = await signUp(app);
    const theirs = await signUp(app);
    const list = await request(app)
      .get("/auth/sessions")
      .set("Origin", WEB_ORIGIN)
      .set("Authorization", bearer(theirs))
      .set("Cookie", theirs.refreshCookie);
    const id = list.body.sessions[0].id as string;
    const res = await request(app)
      .delete(`/auth/sessions/${id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Authorization", bearer(mine));
    expect(res.status).toBe(404);
  });

  it("needs a signed-in user", async () => {
    expect((await request(app).get("/auth/sessions").set("Origin", WEB_ORIGIN)).status).toBe(401);
  });
});
