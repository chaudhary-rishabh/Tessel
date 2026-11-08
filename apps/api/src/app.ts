import type {
  ApiError,
  DependencyCheck,
  HealthResponse,
  ReadinessResponse,
} from "@tessel/contracts";
import type { Logger } from "@tessel/logger";
import express, { type ErrorRequestHandler, type Express } from "express";
import type { DependencyCheckFn } from "./health/checks";

export interface AppDependencies {
  service: string;
  logger: Logger;
  readinessChecks: DependencyCheckFn[];
  /** Include dependency error messages in readiness output. Off in production. */
  exposeCheckErrors: boolean;
}

export function createApp({
  service,
  logger,
  readinessChecks,
  exposeCheckErrors,
}: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");

  // Liveness: the process is up and serving requests.
  app.get("/health", (_req, res) => {
    const body: HealthResponse = {
      status: "ok",
      service,
      uptimeSeconds: Math.round(process.uptime()),
    };
    res.json(body);
  });

  // Readiness: every dependency the API needs is reachable.
  app.get("/health/ready", async (_req, res) => {
    const results = await Promise.all(readinessChecks.map((check) => check()));
    const ready = results.every((result) => result.status === "up");
    const checks: DependencyCheck[] = exposeCheckErrors
      ? results
      : results.map(({ error: _error, ...rest }) => rest);
    const body: ReadinessResponse = { status: ready ? "ready" : "not_ready", service, checks };
    res.status(ready ? 200 : 503).json(body);
  });

  app.use((_req, res) => {
    const body: ApiError = { error: { code: "not_found", message: "Route not found" } };
    res.status(404).json(body);
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    logger.error({ err: error }, "Unhandled request error");
    const body: ApiError = { error: { code: "internal_error", message: "Something went wrong" } };
    res.status(500).json(body);
  };
  app.use(errorHandler);

  return app;
}
