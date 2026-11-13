import {
  cancelSubscriptionRequestSchema,
  checkoutRequestSchema,
  updateExtraUsageRequestSchema,
  updateTaxDetailsRequestSchema,
  workspaceParamsSchema,
} from "@tessel/contracts";
import express, { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { getAuth } from "../../middleware/require-auth";
import type { BillingActor, BillingService } from "./billing.service";

const actorOf = (req: Request): BillingActor => ({
  userId: getAuth(req).userId,
  workspaceId: workspaceParamsSchema.parse(req.params).workspaceId,
  ipAddress: req.ip,
});

/** Plans, usage, and extra usage, under /workspaces/:workspaceId/billing. */
export function createBillingRouter({
  service,
  authenticate,
}: {
  service: BillingService;
  authenticate: RequestHandler;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store").json(await service.summary(actorOf(req)));
  });
  router.put("/extra-usage", async (req, res) => {
    res.json(
      await service.updateExtraUsage(actorOf(req), updateExtraUsageRequestSchema.parse(req.body)),
    );
  });
  router.put("/tax", async (req, res) => {
    res.json(await service.updateTax(actorOf(req), updateTaxDetailsRequestSchema.parse(req.body)));
  });
  router.get("/invoices", async (req, res) => {
    res.set("Cache-Control", "no-store").json({ invoices: await service.invoices(actorOf(req)) });
  });
  router.post("/checkout", async (req, res) => {
    res.json(await service.checkout(actorOf(req), checkoutRequestSchema.parse(req.body)));
  });
  router.post("/portal", async (req, res) => {
    res.json(await service.portal(actorOf(req)));
  });
  router.post("/cancel", async (req, res) => {
    const { cancel } = cancelSubscriptionRequestSchema.parse(req.body);
    res.json(await service.setCancel(actorOf(req), cancel));
  });
  return router;
}

/**
 * Payment webhooks at /billing/webhooks/:provider. Mounted before the JSON
 * parser: signatures are checked over the exact bytes received.
 */
export function createBillingWebhookRouter({ service }: { service: BillingService }): Router {
  const router = Router();
  router.post("/:provider", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
    const provider = z.enum(["stripe", "razorpay"]).parse(req.params.provider);
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ]),
    );
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const accepted = await service.handleWebhook(provider, body, headers);
    res.status(accepted ? 200 : 400).json({ received: accepted });
  });
  return router;
}
