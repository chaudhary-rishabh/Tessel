import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const HEADER = "x-request-id";
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Gives every request an ID, reusing the caller's (for example the load
 * balancer's) when it is safe to log, and echoes it back in the response.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get(HEADER);
  req.requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(HEADER, req.requestId);
  next();
};
