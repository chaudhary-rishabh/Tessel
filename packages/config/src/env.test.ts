import { describe, expect, it } from "vitest";
import { z } from "zod";
import { nodeEnvSchema, parseEnv } from "./env";

const schema = z.object({
  NODE_ENV: nodeEnvSchema,
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.url(),
});

describe("parseEnv", () => {
  it("returns typed values and applies defaults", () => {
    const env = parseEnv(schema, { PORT: "4000", DATABASE_URL: "postgres://localhost:5432/app" });
    expect(env).toEqual({
      NODE_ENV: "development",
      PORT: 4000,
      DATABASE_URL: "postgres://localhost:5432/app",
    });
  });

  it("lists every invalid variable in one error", () => {
    expect(() => parseEnv(schema, { PORT: "abc" })).toThrowError(
      /Invalid environment variables:[\s\S]*PORT[\s\S]*DATABASE_URL/,
    );
  });
});
