import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTestApp, WEB_ORIGIN } from "./helpers";

describe("API core", () => {
  const app = createTestApp();

  it("adds a request ID to every response", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("always generates its own request ID, whatever the caller sends", async () => {
    // Usage and billing records are keyed by it, so a caller can't choose it.
    const safe = await request(app).get("/health").set("x-request-id", "lb-1234.abc");
    expect(safe.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const unsafe = await request(app)
      .get("/health")
      .set("x-request-id", "bad id with spaces <script>");
    expect(unsafe.headers["x-request-id"]).not.toContain("bad id");
  });

  it("sets security headers", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("allows the web origin with credentials and ignores other origins", async () => {
    const allowed = await request(app).options("/auth/login").set("Origin", WEB_ORIGIN);
    expect(allowed.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const other = await request(app).options("/auth/login").set("Origin", "https://evil.example");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns the standard error shape for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "not_found", requestId: expect.any(String) });
  });

  it("rejects malformed JSON with a clear error", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });

  it("rejects bodies over the size limit", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "a@b.com", password: "x".repeat(1_100_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("payload_too_large");
  });

  it("returns field-level details for validation errors", async () => {
    const res = await request(app).post("/auth/signup").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    const paths = res.body.error.details.map((issue: { path: string }) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(["email", "password"]));
  });

  it("rate limits with a 429 in the standard error shape", async () => {
    const limited = createTestApp({
      config: { rateLimits: { api: { windowMs: 60_000, limit: 2 } } },
    });
    await request(limited).get("/users/me");
    await request(limited).get("/users/me");
    const res = await request(limited).get("/users/me");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("rate_limited");
    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });

  it("never rate limits health checks", async () => {
    const limited = createTestApp({
      config: { rateLimits: { api: { windowMs: 60_000, limit: 1 } } },
    });
    for (let i = 0; i < 3; i += 1) {
      expect((await request(limited).get("/health")).status).toBe(200);
    }
  });
});
