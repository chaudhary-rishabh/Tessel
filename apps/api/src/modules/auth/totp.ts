import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238), as authenticator apps make them:
 * HMAC-SHA1, 30-second steps, 6 digits. Codes from the step before and after
 * are accepted too, for clock drift.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new secret: 20 random bytes, base32-encoded as authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export const totpStep = (at: Date = new Date()) => Math.floor(at.getTime() / 1000 / STEP_SECONDS);

/** The code for one time step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(binary).padStart(DIGITS, "0");
}

/**
 * Checks a code and returns the time step it matched, or null. Pass the last
 * accepted step so a code (or an older one) can't be used again.
 */
export function verifyTotp(
  secret: string,
  code: string,
  { at = new Date(), lastStep = null }: { at?: Date; lastStep?: number | null } = {},
): number | null {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const now = totpStep(at);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

/** The otpauth:// link authenticator apps read from a QR code. */
export function totpUri({
  secret,
  account,
  issuer = "Tessel",
}: {
  secret: string;
  account: string;
  issuer?: string;
}) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
