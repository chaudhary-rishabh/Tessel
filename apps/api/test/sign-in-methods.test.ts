import { randomInt } from "node:crypto";
import { authResponseSchema, publicUserSchema, type AuthResponse } from "@tessel/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSocialProviders } from "../src/modules/auth/social-providers";
import { totpCode, totpStep } from "../src/modules/auth/totp";
import { startMockOAuthProvider, type MockOAuthProvider } from "../src/testing/mock-oauth";
import {
  bearer,
  createTestApp,
  findRefreshCookie,
  resetLinkToken,
  signUp,
  TEST_PASSWORD,
  testOutbox,
  testSms,
  textedCode,
  uniqueEmail,
  WEB_ORIGIN,
} from "./helpers";

let mock: MockOAuthProvider;
let app: ReturnType<typeof createTestApp>;

beforeAll(async () => {
  mock = await startMockOAuthProvider();
  app = createTestApp({
    signIn: {
      apiPublicUrl: "http://localhost:4000",
      sms: testSms,
      providers: createSocialProviders({
        google: { clientId: "google-client", clientSecret: "google-secret" },
        github: { clientId: "github-client", clientSecret: "github-secret" },
        mockBaseUrl: mock.url,
      }),
    },
  });
});
afterAll(() => mock.close());

const uniquePhone = () => `+9198${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;

interface Approval {
  email: string;
  name?: string;
  verified?: boolean;
  deny?: boolean;
}

/** Plays the browser: provider sign-in page, then back to Tessel's callback. Returns where Tessel sends it. */
async function throughProvider(
  start: { location: string; cookie: string },
  provider: "google" | "github",
  approval: Approval,
): Promise<string> {
  const authorize = new URL(start.location);
  expect(authorize.origin).toBe(mock.url);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  const approve = new URL(`/${provider}/approve`, mock.url);
  for (const name of ["redirect_uri", "state", "code_challenge"]) {
    approve.searchParams.set(name, authorize.searchParams.get(name) ?? "");
  }
  approve.searchParams.set("email", approval.email);
  approve.searchParams.set("name", approval.name ?? "Ada Lovelace");
  if (approval.verified !== false) approve.searchParams.set("verified", "true");
  approve.searchParams.set("decision", approval.deny ? "deny" : "allow");
  const back = await fetch(approve, { redirect: "manual" });
  const callback = new URL(back.headers.get("location")!);
  expect(callback.pathname).toBe(`/auth/oauth/${provider}/callback`);

  const res = await request(app)
    .get(`${callback.pathname}${callback.search}`)
    .set("Cookie", start.cookie);
  expect(res.status).toBe(303);
  return res.headers.location as string;
}

async function startLogin(provider: "google" | "github", next?: string) {
  const res = await request(app)
    .get(`/auth/oauth/${provider}/start`)
    .query(next ? { next } : {});
  expect(res.status).toBe(303);
  const cookie = (res.headers["set-cookie"] as unknown as string[]).find((value) =>
    value.startsWith("tessel_oauth="),
  )!;
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Lax/);
  expect(cookie).toMatch(/Path=\/auth\/oauth/);
  return { location: res.headers.location as string, cookie: cookie.split(";")[0]! };
}

/** The ticket (in the fragment) and the page to return to (in the query). */
function ticketFrom(destination: string) {
  const url = new URL(destination);
  expect(`${url.origin}${url.pathname}`).toBe(`${WEB_ORIGIN}/oauth/complete`);
  const params = new URLSearchParams(url.hash.slice(1));
  for (const [key, value] of url.searchParams) params.set(key, value);
  return params;
}

async function exchange(ticket: string) {
  return request(app).post("/auth/oauth/exchange").send({ ticket });
}

async function signInWith(provider: "google" | "github", approval: Approval) {
  const params = ticketFrom(await throughProvider(await startLogin(provider), provider, approval));
  const res = await exchange(params.get("ticket")!);
  expect(res.status).toBe(200);
  return { body: res.body as AuthResponse, cookie: findRefreshCookie(res.headers["set-cookie"]) };
}

describe("sign-in options", () => {
  it("lists what this deployment offers", async () => {
    const res = await request(app).get("/auth/options");
    expect(res.body).toEqual({ google: true, github: true, phone: true });
    const plain = await request(createTestApp({ signIn: { apiPublicUrl: "http://x" } })).get(
      "/auth/options",
    );
    expect(plain.body).toEqual({ google: false, github: false, phone: false });
  });

  it("refuses providers that aren't set up", async () => {
    const plain = createTestApp({ signIn: { apiPublicUrl: "http://x" } });
    expect((await request(plain).get("/auth/oauth/google/start")).status).toBe(404);
  });
});

describe("Google and GitHub sign-in", () => {
  it("creates a verified account with no password on first sign-in", async () => {
    const email = uniqueEmail("google");
    const { body, cookie } = await signInWith("google", { email, name: "Grace Hopper" });
    authResponseSchema.parse(body);
    expect(body.user).toMatchObject({
      email,
      name: "Grace Hopper",
      emailVerified: true,
      hasPassword: false,
    });
    expect(cookie).toBeDefined();

    const workspaces = await request(app)
      .get("/workspaces")
      .set("Authorization", `Bearer ${body.accessToken}`);
    expect(workspaces.body.workspaces[0].name).toBe("Grace's workspace");

    // Signing in again finds the same account.
    const again = await signInWith("google", { email });
    expect(again.body.user.id).toBe(body.user.id);
  });

  it("joins an existing account with the same verified email and tells its owner", async () => {
    const user = await signUp(app);
    const { body } = await signInWith("github", { email: user.email });
    expect(body.user.id).toBe(user.auth.user.id);
    expect(testOutbox.latest(user.email)?.text).toContain("sign in to Tessel with GitHub");
    const identities = await request(app)
      .get("/users/me/identities")
      .set("Authorization", bearer(user));
    expect(identities.body.identities).toEqual([
      { provider: "github", email: user.email, createdAt: expect.any(String) },
    ]);
  });

  it("never matches an account by an email the provider hasn't verified", async () => {
    const user = await signUp(app);
    const destination = await throughProvider(await startLogin("google"), "google", {
      email: user.email,
      verified: false,
    });
    expect(destination).toBe(`${WEB_ORIGIN}/login?error=email_unverified`);
  });

  it("keeps the page to return to", async () => {
    const start = await startLogin("google", "/documents");
    const params = ticketFrom(await throughProvider(start, "google", { email: uniqueEmail() }));
    expect(params.get("next")).toBe("/documents");
  });

  it("rejects a next path that leaves the app", async () => {
    const res = await request(app)
      .get("/auth/oauth/google/start")
      .query({ next: "//evil.example" });
    expect(res.status).toBe(400);
  });

  it("reports a cancelled sign-in", async () => {
    const destination = await throughProvider(await startLogin("github"), "github", {
      email: uniqueEmail(),
      deny: true,
    });
    expect(destination).toBe(`${WEB_ORIGIN}/login?error=oauth_cancelled`);
  });

  it("rejects a callback without the browser's state cookie, or with someone else's", async () => {
    const mine = await startLogin("google");
    const theirs = await startLogin("google");
    const destination = await throughProvider({ ...mine, cookie: theirs.cookie }, "google", {
      email: uniqueEmail(),
    });
    expect(destination).toBe(`${WEB_ORIGIN}/login?error=oauth_expired`);
    const noCookie = await request(app).get("/auth/oauth/google/callback?code=x&state=y");
    expect(noCookie.headers.location).toBe(`${WEB_ORIGIN}/login?error=oauth_expired`);
  });

  it("uses each ticket once", async () => {
    const params = ticketFrom(
      await throughProvider(await startLogin("google"), "google", { email: uniqueEmail() }),
    );
    expect((await exchange(params.get("ticket")!)).status).toBe(200);
    const again = await exchange(params.get("ticket")!);
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("invalid_ticket");
  });

  it("still asks for the authenticator code when two-step sign-in is on", async () => {
    const user = await signUp(app);
    const setup = await request(app)
      .post("/users/me/two-factor/setup")
      .set("Authorization", bearer(user));
    await request(app)
      .post("/users/me/two-factor/enable")
      .set("Authorization", bearer(user))
      .send({ code: totpCode(setup.body.secret, totpStep(new Date())) });

    const params = ticketFrom(
      await throughProvider(await startLogin("google"), "google", { email: user.email }),
    );
    const res = await exchange(params.get("ticket")!);
    expect(res.body).toEqual({ status: "two_factor_required", challengeToken: expect.any(String) });
    expect(findRefreshCookie(res.headers["set-cookie"])).toBeUndefined();
  });

  it("links from Settings, and refuses an account linked to someone else", async () => {
    const user = await signUp(app);
    const link = await request(app)
      .post("/auth/oauth/google/link")
      .set("Origin", WEB_ORIGIN)
      .set("Authorization", bearer(user));
    expect(link.status).toBe(200);
    const cookie = (link.headers["set-cookie"] as unknown as string[])
      .find((value) => value.startsWith("tessel_oauth="))!
      .split(";")[0]!;
    // Linking a Google account with a different email is fine.
    const googleEmail = uniqueEmail("personal");
    const destination = await throughProvider({ location: link.body.url, cookie }, "google", {
      email: googleEmail,
    });
    expect(destination).toBe(`${WEB_ORIGIN}/settings?linked=google#sign-in-methods`);
    const signedIn = await signInWith("google", { email: googleEmail });
    expect(signedIn.body.user.id).toBe(user.auth.user.id);

    const other = await signUp(app);
    const otherLink = await request(app)
      .post("/auth/oauth/google/link")
      .set("Authorization", bearer(other));
    const otherCookie = (otherLink.headers["set-cookie"] as unknown as string[])
      .find((value) => value.startsWith("tessel_oauth="))!
      .split(";")[0]!;
    const taken = await throughProvider(
      { location: otherLink.body.url, cookie: otherCookie },
      "google",
      { email: googleEmail },
    );
    expect(taken).toBe(`${WEB_ORIGIN}/settings?link_error=identity_taken#sign-in-methods`);
  });

  it("unlinks, but not the last way to sign in", async () => {
    const email = uniqueEmail("only-google");
    const { body } = await signInWith("google", { email });
    const auth = `Bearer ${body.accessToken}`;
    const last = await request(app)
      .delete("/users/me/identities/google")
      .set("Authorization", auth);
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe("last_sign_in_method");

    await signInWith("github", { email });
    const res = await request(app).delete("/users/me/identities/google").set("Authorization", auth);
    expect(res.status).toBe(204);
    const identities = await request(app).get("/users/me/identities").set("Authorization", auth);
    expect(
      identities.body.identities.map((identity: { provider: string }) => identity.provider),
    ).toEqual(["github"]);
  });

  it("lets a Google-only account set a password through the reset email", async () => {
    const email = uniqueEmail("set-password");
    await signInWith("google", { email });
    await request(app).post("/auth/password/forgot").send({ email });
    const token = await resetLinkToken(email);
    await request(app).post("/auth/password/reset").send({ token, password: TEST_PASSWORD });
    const login = await request(app).post("/auth/login").send({ email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.hasPassword).toBe(true);
  });
});

describe("phone sign-in", () => {
  async function addPhone(user: Awaited<ReturnType<typeof signUp>>, phone: string) {
    const started = await request(app)
      .post("/users/me/phone")
      .set("Authorization", bearer(user))
      .send({ phone });
    expect(started.status).toBe(202);
    return request(app)
      .post("/users/me/phone/verify")
      .set("Authorization", bearer(user))
      .send({
        challengeId: started.body.challengeId,
        code: textedCode(phone.replace(/[\s-]/g, "")),
      });
  }

  it("adds a number after confirming a texted code, then signs in with it", async () => {
    const user = await signUp(app);
    const phone = uniquePhone();
    const spaced = `${phone.slice(0, 3)} ${phone.slice(3, 8)}-${phone.slice(8)}`;
    const added = await addPhone(user, spaced);
    expect(added.status).toBe(200);
    expect(publicUserSchema.parse(added.body).phone).toBe(phone);
    expect(testOutbox.latest(user.email)?.text).toContain(
      `sign in to Tessel with the phone number ending ${phone.slice(-4)}`,
    );

    const started = await request(app).post("/auth/phone/start").send({ phone });
    expect(started.status).toBe(202);
    expect(testSms.latest(phone)?.text).toContain("sign-in code");
    const res = await request(app)
      .post("/auth/phone/verify")
      .send({ challengeId: started.body.challengeId, code: textedCode(phone) });
    expect(res.status).toBe(200);
    expect(authResponseSchema.parse(res.body).user.id).toBe(user.auth.user.id);
    expect(findRefreshCookie(res.headers["set-cookie"])).toBeDefined();
  });

  it("answers the same for a number with no account, and texts nothing", async () => {
    const phone = uniquePhone();
    const res = await request(app).post("/auth/phone/start").send({ phone });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "code_sent", challengeId: expect.any(String) });
    expect(testSms.latest(phone)).toBeUndefined();
    for (const code of ["000000", "123456"]) {
      const attempt = await request(app)
        .post("/auth/phone/verify")
        .send({ challengeId: res.body.challengeId, code });
      expect(attempt.status).toBe(400);
    }
  });

  it("stops after five wrong codes", async () => {
    const user = await signUp(app);
    const phone = uniquePhone();
    await addPhone(user, phone);
    const started = await request(app).post("/auth/phone/start").send({ phone });
    const right = textedCode(phone);
    const wrong = right === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post("/auth/phone/verify")
        .send({ challengeId: started.body.challengeId, code: wrong });
    }
    const res = await request(app)
      .post("/auth/phone/verify")
      .send({ challengeId: started.body.challengeId, code: right });
    expect(res.status).toBe(400);
  });

  it("refuses a number another account uses", async () => {
    const phone = uniquePhone();
    await addPhone(await signUp(app), phone);
    const res = await addPhone(await signUp(app), phone);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("phone_taken");
  });

  it("rejects numbers without a country code", async () => {
    const res = await request(app).post("/auth/phone/start").send({ phone: "98765 43210" });
    expect(res.status).toBe(400);
  });

  it("removes a number, which then can't sign in", async () => {
    const user = await signUp(app);
    const phone = uniquePhone();
    await addPhone(user, phone);
    const removed = await request(app).delete("/users/me/phone").set("Authorization", bearer(user));
    expect(removed.body.phone).toBeNull();
    const started = await request(app).post("/auth/phone/start").send({ phone });
    expect(testSms.latest(phone)?.text).not.toContain("sign-in code");
    expect(started.status).toBe(202);
  });
});
