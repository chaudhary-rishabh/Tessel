import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpCode,
  totpStep,
  totpUri,
  verifyTotp,
} from "./totp";

// RFC 6238 test secret: "12345678901234567890" in ASCII.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("round-trips base32", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 128, 64]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("matches the RFC 6238 test vectors (last six digits)", () => {
    const vectors: [number, string][] = [
      [59, "287082"],
      [1111111109, "081804"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ];
    for (const [seconds, code] of vectors) {
      expect(totpCode(RFC_SECRET, totpStep(new Date(seconds * 1000)))).toBe(code);
    }
  });

  it("accepts the neighbouring steps once each, and nothing else", () => {
    const at = new Date(1_700_000_000_000);
    const step = totpStep(at);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), { at })).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), { at })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), { at })).toBeNull();
    // Replay of the same code is refused.
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), { at, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12 34 56", { at })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abc", { at })).toBeNull();
  });

  it("builds an otpauth link for authenticator apps", () => {
    expect(totpUri({ secret: "ABC", account: "ada@example.com" })).toBe(
      "otpauth://totp/Tessel%3Aada%40example.com?secret=ABC&issuer=Tessel&algorithm=SHA1&digits=6&period=30",
    );
  });
});
