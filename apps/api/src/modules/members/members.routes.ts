import {
  auditLogQuerySchema,
  createInvitationRequestSchema,
  invitationParamsSchema,
  invitationTokenParamsSchema,
  memberParamsSchema,
  transferOwnershipRequestSchema,
  updateMemberRequestSchema,
  workspaceParamsSchema,
} from "@tessel/contracts";
import { Router, type Request, type RequestHandler } from "express";
import type { RateLimitRule } from "../../middleware/rate-limit";
import { createRateLimiter, type RateLimitStoreFactory } from "../../middleware/rate-limit";
import { getAuth } from "../../middleware/require-auth";
import type { MemberActor, MembersService } from "./members.service";

const actorOf = (req: Request): MemberActor => ({ userId: getAuth(req).userId, ipAddress: req.ip });

/** Members, invitations, and the audit log, under /workspaces/:workspaceId. */
export function createMembersRouter({
  service,
  authenticate,
  inviteRateLimit,
  storeFactory,
}: {
  service: MembersService;
  authenticate: RequestHandler;
  inviteRateLimit: RateLimitRule;
  storeFactory?: RateLimitStoreFactory | undefined;
}): Router {
  const router = Router({ mergeParams: true });
  const inviteLimiter = createRateLimiter({
    name: "invite",
    ...inviteRateLimit,
    storeFactory,
    keySuffix: (req) => req.auth?.userId,
  });
  const workspaceOf = (req: Request) => workspaceParamsSchema.parse(req.params).workspaceId;

  router.use(authenticate);
  router.get("/members", async (req, res) => {
    res.json({ members: await service.list(getAuth(req).userId, workspaceOf(req)) });
  });
  router.patch("/members/:userId", async (req, res) => {
    const { workspaceId, userId } = memberParamsSchema.parse(req.params);
    const { role } = updateMemberRequestSchema.parse(req.body);
    res.json(await service.updateRole(actorOf(req), workspaceId, userId, role));
  });
  router.delete("/members/:userId", async (req, res) => {
    const { workspaceId, userId } = memberParamsSchema.parse(req.params);
    await service.remove(actorOf(req), workspaceId, userId);
    res.status(204).end();
  });
  router.post("/transfer", async (req, res) => {
    const { userId } = transferOwnershipRequestSchema.parse(req.body);
    await service.transferOwnership(actorOf(req), workspaceOf(req), userId);
    res.status(204).end();
  });
  router.get("/invitations", async (req, res) => {
    res.json({ invitations: await service.listInvitations(getAuth(req).userId, workspaceOf(req)) });
  });
  router.post("/invitations", inviteLimiter, async (req, res) => {
    const input = createInvitationRequestSchema.parse(req.body);
    res.status(201).json(await service.invite(actorOf(req), workspaceOf(req), input));
  });
  router.delete("/invitations/:invitationId", async (req, res) => {
    const { workspaceId, invitationId } = invitationParamsSchema.parse(req.params);
    await service.revokeInvitation(actorOf(req), workspaceId, invitationId);
    res.status(204).end();
  });
  router.get("/audit-log", async (req, res) => {
    const query = auditLogQuerySchema.parse(req.query);
    res.json(await service.auditLog(getAuth(req).userId, workspaceOf(req), query));
  });
  return router;
}

/** Invitation links: a public preview, and accepting while signed in. Under /invitations. */
export function createInvitationLinksRouter({
  service,
  authenticate,
}: {
  service: MembersService;
  authenticate: RequestHandler;
}): Router {
  const router = Router();
  router.get("/:token", async (req, res) => {
    const { token } = invitationTokenParamsSchema.parse(req.params);
    res.set("Cache-Control", "no-store").json(await service.preview(token));
  });
  router.post("/:token/accept", authenticate, async (req, res) => {
    const { token } = invitationTokenParamsSchema.parse(req.params);
    res.json({ workspace: await service.accept(actorOf(req), token) });
  });
  return router;
}
