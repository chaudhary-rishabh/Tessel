import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createSessionTokens, generateRefreshToken, hashToken } from "./tokens";

const secret = "unit-test-secret-that-is-at-least-32-chars";

describe("access tokens", () => {
  const tokens = createSessionTokens({ secret, ttlSeconds: 900 });

  it("round-trip the user and role", async () => {
    const userId = randomUUID();
    const token = await tokens.sign({ userId, role: "admin" });
    await expect(tokens.verify(token)).resolves.toEqual({ userId, role: "admin" });
  });

  it("reject expired tokens", async () => {
    const expired = await new SignJWT({ role: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(randomUUID())
      .setIssuer("tessel-api")
      .setAudience("tessel")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(secret));
    await expect(tokens.verify(expired)).rejects.toThrow();
  });

  it("reject tokens for another audience or with unexpected claims", async () => {
    const key = new TextEncoder().encode(secret);
    const wrongAudience = await new SignJWT({ role: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(randomUUID())
      .setIssuer("tessel-api")
      .setAudience("someone-else")
      .setExpirationTime("5m")
      .sign(key);
    await expect(tokens.verify(wrongAudience)).rejects.toThrow();

    const badRole = await new SignJWT({ role: "superuser" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(randomUUID())
      .setIssuer("tessel-api")
      .setAudience("tessel")
      .setExpirationTime("5m")
      .sign(key);
    await expect(tokens.verify(badRole)).rejects.toThrow();
  });
});

describe("refresh tokens", () => {
  it("are random and stored only as a hash", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
});
