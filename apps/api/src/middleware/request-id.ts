import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const HEADER = "x-request-id";
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Gives every request a fresh ID, echoed back in the response. The ID keys
 * usage and billing records, so it is always generated here: a caller could
 * otherwise reuse one ID to hide extra usage from the cap. A safe incoming ID
 * (for example a load balancer's) is kept as `upstreamRequestId` for logs.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get(HEADER);
  req.requestId = randomUUID();
  if (incoming && SAFE_ID.test(incoming)) req.upstreamRequestId = incoming;
  res.setHeader(HEADER, req.requestId);
  next();
};
