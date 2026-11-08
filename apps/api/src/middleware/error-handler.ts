import { AiError, CostCapExceededError } from "@tessel/ai";
import type { ApiError } from "@tessel/contracts";
import type { Logger } from "@tessel/logger";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors";

function send(res: Parameters<RequestHandler>[1], status: number, error: ApiError["error"]): void {
  const body: ApiError = { error };
  res.status(status).json(body);
}

export const notFoundHandler: RequestHandler = (req, res) => {
  send(res, 404, { code: "not_found", message: "Route not found", requestId: req.requestId });
};

/** Turns every thrown error into the standard error shape. Unknown errors never leak details. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const requestId = req.requestId;

    if (error instanceof AppError) {
      send(res, error.status, {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
      return;
    }

    if (error instanceof AiError) {
      if (error instanceof CostCapExceededError) {
        const seconds = Math.max(1, Math.ceil((error.resetsAt.getTime() - Date.now()) / 1000));
        res.set("Retry-After", String(seconds));
      }
      if (error.status >= 500) logger.warn({ err: error, requestId }, "AI request failed");
      send(res, error.status, {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
      return;
    }

    if (error instanceof z.ZodError) {
      send(res, 400, {
        code: "validation_error",
        message: "Some fields are invalid",
        requestId,
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    // Errors raised by express.json() for bad or oversized bodies.
    if (typeof error === "object" && error !== null && "type" in error) {
      if (error.type === "entity.parse.failed") {
        send(res, 400, {
          code: "invalid_json",
          message: "Request body is not valid JSON",
          requestId,
        });
        return;
      }
      if (error.type === "entity.too.large") {
        send(res, 413, {
          code: "payload_too_large",
          message: "Request body is too large",
          requestId,
        });
        return;
      }
    }

    logger.error({ err: error, requestId }, "Unhandled request error");
    send(res, 500, { code: "internal_error", message: "Something went wrong", requestId });
  };
}
