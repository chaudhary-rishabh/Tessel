import type { BillingAccountRow } from "@tessel/db";
import { PLANS } from "@tessel/contracts";
import { describe, expect, it } from "vitest";
import { effectivePlan, modelTier, PAST_DUE_GRACE_MS } from "./usage-limits";

const DAY = 86_400_000;
const now = new Date("2026-11-09T12:00:00Z");

function account(values: Partial<BillingAccountRow>): BillingAccountRow {
  return {
    workspaceId: "w",
    plan: "pro",
    status: "active",
    provider: "stripe",
    customerId: "cus",
    subscriptionId: "sub",
    seats: 1,
    currentPeriodStart: new Date(now.getTime() - 10 * DAY),
    currentPeriodEnd: new Date(now.getTime() + 20 * DAY),
    cancelAtPeriodEnd: false,
    extraUsageEnabled: false,
    extraUsageCapNanoUsd: 0,
    createdAt: now,
    updatedAt: now,
    ...values,
  } as BillingAccountRow;
}

describe("effectivePlan", () => {
  it("is the paid plan while it's active", () => {
    expect(effectivePlan(account({}), now)).toBe(PLANS.pro);
  });

  it("falls back to Free when cancelled, never paid, or missing", () => {
    expect(effectivePlan(account({ status: "cancelled" }), now)).toBe(PLANS.free);
    expect(effectivePlan(account({ status: "incomplete" }), now)).toBe(PLANS.free);
    expect(effectivePlan(undefined, now)).toBe(PLANS.free);
  });

  it("keeps a past-due plan for a grace period after its billing period ends", () => {
    const ended = (ago: number) =>
      account({ status: "past_due", currentPeriodEnd: new Date(now.getTime() - ago) });
    expect(effectivePlan(account({ status: "past_due" }), now)).toBe(PLANS.pro);
    expect(effectivePlan(ended(PAST_DUE_GRACE_MS - DAY), now)).toBe(PLANS.pro);
    expect(effectivePlan(ended(PAST_DUE_GRACE_MS + DAY), now)).toBe(PLANS.free);
    expect(effectivePlan(account({ status: "past_due", currentPeriodEnd: null }), now)).toBe(
      PLANS.free,
    );
  });
});

describe("modelTier", () => {
  it("reads the tier from the registry and treats unknown models as free", () => {
    const registry = {
      resolve: (id: string | undefined) => {
        if (id === "big") return { tier: "pro" as const };
        throw new Error("unknown");
      },
    };
    expect(modelTier(registry, "big")).toBe("pro");
    expect(modelTier(registry, "missing")).toBe("free");
  });
});
