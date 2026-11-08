import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startHealthServer } from "./health";

const servers: ReturnType<typeof startHealthServer>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function get(state: { running: boolean; connected: boolean }, path = "/health") {
  const server = startHealthServer(0, {
    isRunning: () => state.running,
    isConnected: () => state.connected,
  });
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}${path}`);
}

describe("worker health endpoint", () => {
  it("is healthy when running and connected", async () => {
    const res = await get({ running: true, connected: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", service: "worker" });
  });

  it("is unhealthy when Redis is disconnected", async () => {
    const res = await get({ running: true, connected: false });
    expect(res.status).toBe(503);
  });

  it("returns 404 for other paths", async () => {
    const res = await get({ running: true, connected: true }, "/other");
    expect(res.status).toBe(404);
  });
});
