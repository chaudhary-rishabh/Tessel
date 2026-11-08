import { resolve } from "node:path";
import { config } from "dotenv";
import { z } from "zod";

/**
 * Loads `.env` from the current app folder first, then from the repo root.
 * Values already set in the process environment always win, so containers
 * and CI can inject configuration without any files.
 */
export function loadEnvFiles(cwd: string = process.cwd()): void {
  config({
    path: [resolve(cwd, ".env"), resolve(cwd, "../../.env")],
    quiet: true,
  });
}

export const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

export const logLevelSchema = z
  .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
  .optional();

/**
 * Validates environment variables against a Zod schema and fails fast with a
 * readable list of every problem, instead of crashing later at first use.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.output<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return result.data;
}
