import type { Request } from "express";
import type { SessionMeta } from "./auth.service";

/** Device details stored with a session so users can recognise it later. */
export function sessionMeta(req: Request): SessionMeta {
  return {
    userAgent: req.get("user-agent")?.slice(0, 512),
    ipAddress: req.ip,
  };
}
