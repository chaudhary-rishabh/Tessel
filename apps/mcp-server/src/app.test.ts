import { healthResponseSchema } from "@tessel/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("mcp-server", () => {
  it("serves a health check", async () => {
    const res = await request(createApp("mcp-server")).get("/health");
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body).service).toBe("mcp-server");
  });
});
