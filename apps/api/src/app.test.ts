import { readinessResponseSchema } from "@tessel/contracts";
import { createLogger } from "@tessel/logger";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createCheck } from "./health/checks";

const logger = createLogger("api-test", { level: "silent", pretty: false });

const up = createCheck("postgres", async () => undefined);
const down = createCheck("qdrant", async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:6333");
});

function buildApp(checks = [up], exposeCheckErrors = true) {
  return createApp({ service: "api", logger, readinessChecks: checks, exposeCheckErrors });
}

describe("GET /health", () => {
  it("reports the process is alive", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "api" });
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("GET /health/ready", () => {
  it("returns 200 when every dependency is up", async () => {
    const res = await request(buildApp([up])).get("/health/ready");
    expect(res.status).toBe(200);
    expect(readinessResponseSchema.parse(res.body).status).toBe("ready");
  });

  it("returns 503 and names the failing dependency", async () => {
    const res = await request(buildApp([up, down])).get("/health/ready");
    expect(res.status).toBe(503);
    const body = readinessResponseSchema.parse(res.body);
    expect(body.status).toBe("not_ready");
    expect(body.checks.find((c) => c.name === "qdrant")).toMatchObject({
      status: "down",
      error: "connect ECONNREFUSED 127.0.0.1:6333",
    });
  });

  it("hides dependency error details when configured for production", async () => {
    const res = await request(buildApp([down], false)).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks[0]).not.toHaveProperty("error");
  });

  it("marks a hanging dependency as down instead of waiting forever", async () => {
    const hanging = createCheck("neo4j", () => new Promise(() => undefined), 50);
    const res = await request(buildApp([hanging])).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks[0]).toMatchObject({ name: "neo4j", status: "down" });
  });
});

describe("unknown routes", () => {
  it("return a consistent JSON error", async () => {
    const res = await request(buildApp()).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "not_found", message: "Route not found" } });
  });
});
