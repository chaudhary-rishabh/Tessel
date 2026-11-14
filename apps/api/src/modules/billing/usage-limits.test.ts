import type { BillingAccountRow } from "@tessel/db";
import { PLANS } from "@tessel/contracts";
import { describe, expect, it } from "vitest";
import {
  addMonths,
  effectivePlan,
  extraUsageUnavailable,
  modelTier,
  PAST_DUE_GRACE_MS,
  periodStart,
} from "./usage-limits";

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

describe("periodStart", () => {
  it("is the billing period's start on monthly plans", () => {
    const value = account({ interval: "month" });
    expect(periodStart(value, now)).toEqual(value.currentPeriodStart);
  });

  it("counts months from the start of the year on yearly plans", () => {
    const value = account({
      interval: "year",
      currentPeriodStart: new Date("2026-01-31T08:00:00Z"),
    });
    expect(periodStart(value, now)).toEqual(new Date("2026-10-31T08:00:00Z"));
    expect(periodStart(value, new Date("2026-03-01T00:00:00Z"))).toEqual(
      new Date("2026-02-28T08:00:00Z"),
    );
  });

  it("keeps the day, or the month's last day when it's shorter", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1)).toEqual(
      new Date("2026-02-28T00:00:00Z"),
    );
    expect(addMonths(new Date("2026-05-15T10:00:00Z"), 12)).toEqual(
      new Date("2027-05-15T10:00:00Z"),
    );
  });
});

describe("extraUsageUnavailable", () => {
  it("needs a paid plan, and monthly billing with Razorpay", () => {
    expect(extraUsageUnavailable(PLANS.free, undefined)).toBe("plan");
    expect(extraUsageUnavailable(PLANS.pro, account({ interval: "year" }))).toBeNull();
    expect(
      extraUsageUnavailable(PLANS.pro, account({ provider: "razorpay", interval: "year" })),
    ).toBe("razorpay_yearly");
  });
});
