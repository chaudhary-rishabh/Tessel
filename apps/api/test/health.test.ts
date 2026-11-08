import { readinessResponseSchema } from "@tessel/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createCheck } from "../src/modules/health/checks";
import { createTestApp } from "./helpers";

const up = createCheck("postgres", async () => undefined);
const down = createCheck("qdrant", async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:6333");
});

describe("health checks", () => {
  it("report liveness without exposing framework headers", async () => {
    const res = await request(createTestApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "api" });
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("report ready when every dependency is up", async () => {
    const res = await request(createTestApp({ readinessChecks: [up] })).get("/health/ready");
    expect(res.status).toBe(200);
    expect(readinessResponseSchema.parse(res.body).status).toBe("ready");
  });

  it("return 503 and name the failing dependency", async () => {
    const res = await request(createTestApp({ readinessChecks: [up, down] })).get("/health/ready");
    expect(res.status).toBe(503);
    expect(readinessResponseSchema.parse(res.body).checks).toContainEqual(
      expect.objectContaining({ name: "qdrant", status: "down", error: expect.any(String) }),
    );
  });

  it("hide dependency error details in production", async () => {
    const app = createTestApp({ readinessChecks: [down], config: { isProduction: true } });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks[0]).not.toHaveProperty("error");
  });

  it("mark a hanging dependency as down instead of waiting forever", async () => {
    const hanging = createCheck("neo4j", () => new Promise(() => undefined), 50);
    const res = await request(createTestApp({ readinessChecks: [hanging] })).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks[0]).toMatchObject({ name: "neo4j", status: "down" });
  });
});
