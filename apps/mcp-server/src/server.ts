import { loadEnvFiles, logLevelSchema, nodeEnvSchema, parseEnv } from "@tessel/config/env";
import { createLogger } from "@tessel/logger";
import { z } from "zod";
import { createApp } from "./app";

const SERVICE = "mcp-server";

loadEnvFiles();
const env = parseEnv(
  z.object({
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema,
    MCP_PORT: z.coerce.number().int().positive().default(4100),
  }),
);
const logger = createLogger(SERVICE);

const server = createApp(SERVICE).listen(env.MCP_PORT, () => {
  logger.info({ port: env.MCP_PORT }, "MCP server listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down");
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
