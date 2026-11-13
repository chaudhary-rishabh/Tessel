import {
  adminAuditQuerySchema,
  adminModelsSchema,
  adminUsageQuerySchema,
  adminUserListQuerySchema,
  adminUserParamsSchema,
  updateAdminUserRequestSchema,
} from "@tessel/contracts";
import type { Database } from "@tessel/db";
import { Router, type Request, type RequestHandler } from "express";
import { errors } from "../../lib/errors";
import { getAuth } from "../../middleware/require-auth";
import { usersRepository } from "../users/users.repository";
import type { AdminActor, AdminService } from "./admin.service";

/**
 * Only platform admins, checked against the database on every request (so a
 * removed admin loses access at once), never with an access token or API
 * token alone. In production an admin must also have two-step sign-in on.
 */
export function requireAdmin(db: Database, { requireTwoFactor }: { requireTwoFactor: boolean }) {
  const handler: RequestHandler = async (req, _res, next) => {
    const auth = getAuth(req);
    if (auth.token) throw errors.forbidden("Admin pages need a signed-in session", "admin_only");
    const user = await usersRepository.findById(db, auth.userId);
    if (!user || user.role !== "admin" || user.suspendedAt) {
      throw errors.forbidden("Only Tessel admins can open this", "admin_only");
    }
    if (requireTwoFactor && !user.totpEnabledAt) {
      throw errors.forbidden(
        "Turn on two-step sign-in in your Tessel settings to use the admin app",
        "admin_two_factor_required",
      );
    }
    next();
  };
  return handler;
}

const actorOf = (req: Request): AdminActor => ({ userId: getAuth(req).userId, ipAddress: req.ip });

export function createAdminRouter({
  service,
  authenticate,
  db,
  requireTwoFactor,
}: {
  service: AdminService;
  authenticate: RequestHandler;
  db: Database;
  requireTwoFactor: boolean;
}): Router {
  const router = Router();
  router.use(authenticate, requireAdmin(db, { requireTwoFactor }));
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/overview", async (_req, res) => {
    res.json(await service.overview());
  });
  router.get("/users", async (req, res) => {
    res.json(await service.listUsers(adminUserListQuerySchema.parse(req.query)));
  });
  router.get("/users/:userId", async (req, res) => {
    res.json(await service.getUser(adminUserParamsSchema.parse(req.params).userId));
  });
  router.patch("/users/:userId", async (req, res) => {
    const { userId } = adminUserParamsSchema.parse(req.params);
    res.json(
      await service.updateUser(actorOf(req), userId, updateAdminUserRequestSchema.parse(req.body)),
    );
  });
  router.post("/users/:userId/sign-out", async (req, res) => {
    await service.signOutUser(actorOf(req), adminUserParamsSchema.parse(req.params).userId);
    res.status(204).end();
  });
  router.get("/models", async (_req, res) => {
    res.json(await service.models());
  });
  router.put("/models", async (req, res) => {
    res.json(await service.saveModels(actorOf(req), adminModelsSchema.parse(req.body)));
  });
  router.get("/usage", async (req, res) => {
    res.json(await service.usage(adminUsageQuerySchema.parse(req.query).days));
  });
  router.get("/voice", async (req, res) => {
    res.json(await service.voice(adminUsageQuerySchema.parse(req.query).days));
  });
  router.get("/audit-log", async (req, res) => {
    res.json(await service.auditLog(adminAuditQuerySchema.parse(req.query)));
  });
  return router;
}
