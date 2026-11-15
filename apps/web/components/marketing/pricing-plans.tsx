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
          className="bg-paper inline-flex rounded-full p-1"
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
                "focus-visible:outline-accent rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2",
                currency === value ? "bg-forest text-white" : "text-muted hover:text-ink",
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
                "relative isolate flex flex-col overflow-hidden rounded-[1.75rem] p-7",
                featured ? "green-panel grain text-white" : "bg-paper",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-medium tracking-tight">{plan.name}</h2>
                {featured ? (
                  <span className="bg-mint text-forest rounded-full px-2.5 py-1 text-xs font-medium">
                    Most popular
                  </span>
                ) : null}
              </div>
              <p
                className={cn(
                  "mt-1.5 text-[0.95rem] leading-snug md:min-h-[4.2rem]",
                  featured ? "text-white/75" : "text-muted",
                )}
              >
                {plan.description}
              </p>
              <p className="mt-6 text-5xl font-medium tracking-[-0.05em]">
                {formatPrice(plan, currency)}
              </p>
              <p
                className={cn(
                  "mt-2 text-sm md:min-h-10",
                  featured ? "text-white/65" : "text-muted",
                )}
              >
                {priceNote(plan)}
              </p>
              <Button
                asChild
                variant="secondary"
                className={cn(
                  "mt-7 rounded-full bg-white",
                  featured && "text-forest hover:bg-mint border-transparent",
                )}
              >
                <Link href="/signup">{plan.id === "free" ? "Start free" : `Get ${plan.name}`}</Link>
              </Button>
              <ul
                className={cn(
                  "mt-7 flex flex-col gap-3 border-t pt-6 text-[0.95rem]",
                  featured ? "border-white/15" : "border-line",
                )}
              >
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5">
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 size-4.5 shrink-0",
                        featured ? "text-mint" : "text-accent",
                      )}
                    />
                    {feature}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      <div className="mt-24">
        <h2 className="text-3xl font-medium tracking-[-0.04em] sm:text-5xl">Compare plans</h2>
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
