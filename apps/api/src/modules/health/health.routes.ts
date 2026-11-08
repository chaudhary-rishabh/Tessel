import type { DependencyCheck, HealthResponse, ReadinessResponse } from "@tessel/contracts";
import { Router } from "express";
import type { DependencyCheckFn } from "./checks";

export function createHealthRouter({
  service,
  readinessChecks,
  exposeCheckErrors,
}: {
  service: string;
  readinessChecks: DependencyCheckFn[];
  /** Include dependency error messages in readiness output. Off in production. */
  exposeCheckErrors: boolean;
}): Router {
  const router = Router();

  // Liveness: the process is up and serving requests.
  router.get("/health", (_req, res) => {
    const body: HealthResponse = {
      status: "ok",
      service,
      uptimeSeconds: Math.round(process.uptime()),
    };
    res.json(body);
  });

  // Readiness: every dependency the API needs is reachable.
  router.get("/health/ready", async (_req, res) => {
    const results = await Promise.all(readinessChecks.map((check) => check()));
    const ready = results.every((result) => result.status === "up");
    const checks: DependencyCheck[] = exposeCheckErrors
      ? results
      : results.map(({ error: _error, ...rest }) => rest);
    const body: ReadinessResponse = { status: ready ? "ready" : "not_ready", service, checks };
    res.status(ready ? 200 : 503).json(body);
  });

  return router;
}
