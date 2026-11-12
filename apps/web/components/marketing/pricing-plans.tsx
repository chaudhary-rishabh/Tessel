"use client";

import { PLANS, type Plan } from "@tessel/contracts";
import { Button, cn } from "@tessel/ui";
import { Check } from "lucide-react";
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

export function PricingPlans() {
  const [currency, setCurrency] = useState<Currency>("usd");

  return (
    <div>
      <div className="flex justify-center">
        <div
          role="radiogroup"
          aria-label="Currency"
          className="border-line bg-surface inline-flex rounded-full border p-1"
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
                currency === value ? "bg-ink text-paper" : "text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_ORDER.map((plan) => {
          const featured = plan.id === FEATURED;
          return (
            <li
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-[1.75rem] border p-7",
                featured
                  ? "bg-tile-deep border-tile-deep text-white shadow-xl"
                  : "bg-surface border-line",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">{plan.name}</h2>
                {featured ? (
                  <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
                    Most popular
                  </span>
                ) : null}
              </div>
              <p className={cn("mt-2 text-[0.95rem]", featured ? "text-white/75" : "text-muted")}>
                {plan.description}
              </p>
              <p className="font-display mt-6 text-4xl font-semibold tracking-tight">
                {formatPrice(plan, currency)}
              </p>
              <p className={cn("mt-1 text-sm", featured ? "text-white/70" : "text-muted")}>
                {priceNote(plan)}
              </p>
              <Button
                asChild
                variant={featured ? "secondary" : plan.id === "free" ? "secondary" : "primary"}
                className={cn(
                  "mt-6 rounded-full",
                  featured && "text-tile-deep border-transparent bg-white hover:bg-white/90",
                )}
              >
                <Link href="/signup">{plan.id === "free" ? "Start free" : `Get ${plan.name}`}</Link>
              </Button>
              <ul className="mt-7 flex flex-col gap-3 text-[0.95rem]">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5">
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 size-4.5 shrink-0",
                        featured ? "text-tile-moss" : "text-accent",
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
      <p className="text-muted mt-6 text-center text-sm">
        {currency === "usd"
          ? "Pay by card, through Stripe."
          : "Pay with UPI or an Indian card, through Razorpay."}
      </p>
    </div>
  );
}
