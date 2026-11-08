import type { Logger } from "@tessel/logger";
import type { Request } from "express";
import { pinoHttp } from "pino-http";

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
    customProps: (req) => ({ userId: (req as Request).auth?.userId }),
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}
