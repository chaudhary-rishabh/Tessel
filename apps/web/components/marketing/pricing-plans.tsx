"use client";

import { PLANS, type Plan } from "@tessel/contracts";
import { Button, cn } from "@tessel/ui";
import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type Currency = "usd" | "inr";

const PLAN_ORDER = [PLANS.free, PLANS.pro, PLANS.max, PLANS.team];
const FEATURED = "pro";

function formatPrice(plan: Plan, currency: Currency): string {
  return new Intl.NumberFormat(currency === "usd" ? "en-US" : "en-IN", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(plan.price[currency]);
}

function priceNote(plan: Plan): string {
  if (plan.price.usd === 0) return "Free for ever";
  if (plan.perSeat) return `Per person each month, from ${plan.minSeats} people`;
  return "Per month";
}

/** How a plan's usage compares with Free's, from the limits themselves. */
function usage(plan: Plan): string {
  const times = plan.limits.weekNanoUsd / PLANS.free.limits.weekNanoUsd;
  if (times === 1) return "Standard";
  return `${times}× Free${plan.perSeat ? ", per person" : ""}`;
}

/** What each plan includes, row by row, in the order of PLAN_ORDER. */
const COMPARISON: readonly { label: string; values: readonly (string | boolean)[] }[] = [
  { label: "Usage", values: PLAN_ORDER.map(usage) },
  {
    label: "Models",
    values: PLAN_ORDER.map((plan) =>
      plan.modelTier === "free" ? "Everyday models" : "Every model",
    ),
  },
  { label: "Extra usage past the limits", values: PLAN_ORDER.map((plan) => plan.extraUsage) },
  { label: "Cited answers from your documents", values: [true, true, true, true] },
  { label: "Skills, connectors, and memory", values: [true, true, true, true] },
  { label: "Pages, apps, and images", values: [true, true, true, true] },
  { label: "Video generation", values: [false, true, true, true] },
  { label: "Your own voice", values: [false, true, true, true] },
  { label: "Admin controls and audit log", values: [false, false, false, true] },
];

export function PricingPlans() {
  const [currency, setCurrency] = useState<Currency>("usd");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div
          role="radiogroup"
          aria-label="Currency"
          className="bg-ink/6 inline-flex rounded-[0.7rem] p-1"
        >
          {(
            [
              ["usd", "US dollars"],
              ["inr", "Indian rupees"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={currency === value}
              onClick={() => setCurrency(value)}
              className={cn(
                "focus-visible:outline-accent rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2",
                currency === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-muted text-sm">
          {currency === "usd"
            ? "Pay by card, through Stripe."
            : "Pay with UPI or an Indian card, through Razorpay."}
        </p>
      </div>

      <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_ORDER.map((plan) => {
          const featured = plan.id === FEATURED;
          return (
            <li
              key={plan.id}
              className={cn(
                "bg-surface flex flex-col rounded-2xl border p-7",
                featured ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "border-line",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight">{plan.name}</h2>
                {featured ? (
                  <span className="bg-tile-ochre/25 rounded-md px-2.5 py-1 text-xs font-medium">
                    Most popular
                  </span>
                ) : null}
              </div>
              <p className="text-muted mt-1.5 min-h-[4.2rem] text-[0.95rem] leading-snug">
                {plan.description}
              </p>
              <p className="mt-6 text-5xl font-semibold tracking-[-0.04em]">
                {formatPrice(plan, currency)}
              </p>
              <p className="text-muted mt-2 text-sm">{priceNote(plan)}</p>
              <Button
                asChild
                variant="secondary"
                className={cn(
                  "mt-7 rounded-xl",
                  featured && "bg-ink text-paper hover:bg-ink/85 border-transparent",
                )}
              >
                <Link href="/signup">{plan.id === "free" ? "Start free" : `Get ${plan.name}`}</Link>
              </Button>
              <ul className="border-line mt-7 flex flex-col gap-3 border-t pt-6 text-[0.95rem]">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5">
                    <Check aria-hidden="true" className="text-accent mt-0.5 size-4.5 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      <div className="mt-24">
        <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Compare plans</h2>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-[0.95rem]">
            <thead>
              <tr className="border-line border-b">
                <th scope="col" className="w-[34%] py-4 pr-4 font-normal">
                  <span className="sr-only">What&apos;s included</span>
                </th>
                {PLAN_ORDER.map((plan) => (
                  <th key={plan.id} scope="col" className="px-3 py-4 font-semibold">
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label} className="border-line border-b">
                  <th scope="row" className="py-4 pr-4 font-normal">
                    {row.label}
                  </th>
                  {row.values.map((value, index) => (
                    <td key={PLAN_ORDER[index]!.id} className="text-muted px-3 py-4">
                      {value === true ? (
                        <Check aria-label="Included" className="text-accent size-4.5" />
                      ) : value === false ? (
                        <Minus aria-label="Not included" className="text-muted/50 size-4.5" />
                      ) : (
                        value
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
