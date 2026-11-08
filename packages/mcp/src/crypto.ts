import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts connector credentials (tokens, OAuth client secrets) before they
 * reach the database, with AES-256-GCM and a key from the environment. The
 * version prefix leaves room for key rotation.
 */
export interface SecretBox {
  seal(value: unknown): string;
  open<T>(sealed: string): T;
}

export function createSecretBox(base64Key: string): SecretBox {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("CONNECTOR_SECRET_KEY must be 32 bytes, base64-encoded");
  return {
    seal(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return [
        "v1",
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        data.toString("base64"),
      ].join(":");
    },
    open<T>(sealed: string): T {
      const [version, iv, tag, data] = sealed.split(":");
      if (version !== "v1" || !iv || !tag || !data)
        throw new Error("Unreadable connector credentials");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      const text = Buffer.concat([
        decipher.update(Buffer.from(data, "base64")),
        decipher.final(),
      ]).toString("utf8");
      return JSON.parse(text) as T;
    },
  };
}
