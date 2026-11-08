import type { ApiError, HealthResponse } from "@tessel/contracts";
import express, { type Express } from "express";

// The MCP endpoint (Streamable HTTP + personal access tokens) is added in step 13.
export function createApp(service: string): Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    const body: HealthResponse = {
      status: "ok",
      service,
      uptimeSeconds: Math.round(process.uptime()),
    };
    res.json(body);
  });

  app.use((_req, res) => {
    const body: ApiError = { error: { code: "not_found", message: "Route not found" } };
    res.status(404).json(body);
  });

  return app;
}
