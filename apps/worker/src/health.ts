import { createServer, type Server } from "node:http";

export interface WorkerHealthSource {
  /** True while the worker is processing (not closing or closed). */
  isRunning: () => boolean;
  /** True while the queue Redis connection is ready. */
  isConnected: () => boolean;
}

/**
 * A tiny HTTP endpoint so container health checks and deploys can tell
 * whether the worker is up. GET /health returns 200 when healthy, else 503.
 */
export function startHealthServer(port: number, source: WorkerHealthSource): Server {
  const server = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    const running = source.isRunning();
    const connected = source.isConnected();
    const healthy = running && connected;
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: healthy ? "ok" : "unhealthy",
        service: "worker",
        running,
        connected,
      }),
    );
  });
  server.listen(port);
  return server;
}
