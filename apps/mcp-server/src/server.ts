import { loadEnvFiles, logLevelSchema, nodeEnvSchema, parseEnv } from "@tessel/config/env";
import { createLogger } from "@tessel/logger";
import { createMcpServerApp } from "@tessel/mcp/server";
import { z } from "zod";

const SERVICE = "mcp-server";

loadEnvFiles();
const env = parseEnv(
  z
    .object({
      NODE_ENV: nodeEnvSchema,
      LOG_LEVEL: logLevelSchema,
      MCP_PORT: z.coerce.number().int().positive().default(4100),
      /** The API as this server reaches it: http://api:4000 in Compose. */
      API_INTERNAL_URL: z.url().default("http://localhost:4000"),
      /** How outside clients reach this server and the API, for OAuth sign-in. Required in production. */
      MCP_PUBLIC_URL: z.url().optional(),
      API_PUBLIC_URL: z.url().optional(),
      /** Number of proxies in front of this server (1 behind Caddy). */
      TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    })
    .refine((env) => env.NODE_ENV !== "production" || (env.MCP_PUBLIC_URL && env.API_PUBLIC_URL), {
      message: "Set MCP_PUBLIC_URL and API_PUBLIC_URL in production",
      path: ["MCP_PUBLIC_URL"],
    }),
);
const logger = createLogger(SERVICE);

const server = createMcpServerApp({
  service: SERVICE,
  apiUrl: env.API_INTERNAL_URL,
  logger,
  trustProxy: env.TRUST_PROXY,
  oauth: {
    resourceUrl: new URL("/mcp", env.MCP_PUBLIC_URL ?? "http://localhost:4100").toString(),
    authorizationServerUrl: new URL("/", env.API_PUBLIC_URL ?? "http://localhost:4000").toString(),
  },
}).listen(env.MCP_PORT, () => logger.info({ port: env.MCP_PORT }, "MCP server listening"));

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down");
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
