import { healthResponseSchema } from "@tessel/contracts";
import { createLogger } from "@tessel/logger";
import { createMcpServerApp } from "@tessel/mcp/server";
import request from "supertest";
import { describe, expect, it } from "vitest";

const logger = createLogger("mcp-server-test", { level: "silent", pretty: false });

// The full path (client → MCP server → API) is tested in apps/api/test/mcp-server.test.ts.
describe("mcp-server", () => {
  const app = createMcpServerApp({
    service: "mcp-server",
    apiUrl: "http://127.0.0.1:9",
    logger,
    fetchFn: async () =>
      new Response(JSON.stringify({ error: { code: "invalid_token", message: "No" } }), {
        status: 401,
      }),
  });

  it("serves a health check", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body).service).toBe("mcp-server");
  });

  it("asks for a token, and refuses one the API rejects", async () => {
    const missing = await request(app).post("/mcp").send({});
    expect(missing.status).toBe(401);
    expect(missing.headers["www-authenticate"]).toContain("Bearer");
    const rejected = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer tsl_pat_nope")
      .send({});
    expect(rejected.status).toBe(401);
  });

  it("only takes POST on the MCP endpoint", async () => {
    expect((await request(app).get("/mcp")).status).toBe(405);
  });

  it("limits requests per token", async () => {
    const limited = createMcpServerApp({
      service: "mcp-server",
      apiUrl: "http://127.0.0.1:9",
      logger,
      requestsPerMinute: 2,
      fetchFn: async () => new Response("{}", { status: 401 }),
    });
    const send = (token: string) =>
      request(limited).post("/mcp").set("Authorization", `Bearer ${token}`).send({});
    expect((await send("tsl_pat_a")).status).toBe(401);
    expect((await send("tsl_pat_a")).status).toBe(401);
    expect((await send("tsl_pat_a")).status).toBe(429);
    expect((await send("tsl_pat_b")).status).toBe(401);
  });
});
