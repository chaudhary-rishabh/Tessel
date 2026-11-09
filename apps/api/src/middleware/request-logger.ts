import type { Logger } from "@tessel/logger";
import type { Request } from "express";
import { pinoHttp } from "pino-http";

/**
 * The path to log: no query string (OAuth codes and states travel there) and
 * no invitation token, which works like a password until it's used.
 */
export function loggablePath(url: string | undefined): string {
  const path = (url ?? "").split("?")[0] ?? "";
  return path.replace(/\/invitations\/[^/]+/, "/invitations/:token");
}

/** One structured log line per request, tagged with the request ID and user. */
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req) => (req as Request).requestId,
    autoLogging: { ignore: (req) => req.url?.startsWith("/health") ?? false },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customProps: (req) => ({
      userId: (req as Request).auth?.userId,
      upstreamRequestId: (req as Request).upstreamRequestId,
    }),
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: loggablePath(req.url),
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}
