import { z } from "zod";

const optional = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

/** Settings for connectors (MCP servers Tessel connects to for users). */
export const connectorsEnvShape = {
  /** Where browsers reach the API, for OAuth redirects. */
  API_PUBLIC_URL: z.url().default("http://localhost:4000"),
  /** 32 random bytes, base64. Encrypts connector tokens at rest. */
  CONNECTOR_SECRET_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, "base64").length === 32,
      "CONNECTOR_SECRET_KEY must be 32 bytes, base64-encoded",
    ),
  /** Lets connectors use http and private addresses. Local development and tests only. */
  CONNECTORS_ALLOW_PRIVATE_NETWORKS: z.stringbool().default(false),
  GITHUB_MCP_URL: z.url().default("https://api.githubcopilot.com/mcp/"),
  /** A GitHub OAuth app for the GitHub connector; without one, users paste a token. */
  GITHUB_MCP_CLIENT_ID: optional,
  GITHUB_MCP_CLIENT_SECRET: optional,
};
