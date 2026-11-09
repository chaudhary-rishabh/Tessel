"use client";

import { toApiClientError } from "@tessel/api-client";
import { queryKeys, useApi, useBilling } from "@tessel/api-client/react";
import { PLANS, type BillingSummary, type Plan, type UsageWindow } from "@tessel/contracts";
import { Button, cn, Spinner, TextField } from "@tessel/ui";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FormError } from "@/components/form-error";
import { toast } from "@/lib/toast-store";

const USD = 1_000_000_000;
/** Long button labels wrap inside narrow plan cards instead of overflowing. */
const WRAP = "h-auto min-h-10 whitespace-normal py-2 text-center leading-snug";

function UsageBar({ label, window }: { label: string; window: UsageWindow }) {
  const percent = Math.min(100, Math.round(window.used * 100));
  const resets = window.resetsAt
    ? new Date(window.resetsAt).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted tabular-nums">{percent}% used</span>
      </div>
      <div
        role="meter"
        aria-label={`${label} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="bg-ink/8 mt-1.5 h-2 overflow-hidden rounded-full"
      >
        <div
          className={cn("h-full rounded-full", percent >= 100 ? "bg-danger" : "bg-accent")}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-muted mt-1 text-xs">
        {resets ? `Resets ${resets}` : "Starts with your next message"}
      </p>
    </div>
  );
}

function price(plan: Plan) {
  if (plan.price.usd === 0) return "Free";
  return `$${plan.price.usd} or ₹${plan.price.inr.toLocaleString("en-IN")} a month${plan.perSeat ? " per person" : ""}`;
}

function PlanCards({
  summary,
  workspaceId,
  isPersonal,
}: {
  summary: BillingSummary;
  workspaceId: string;
  isPersonal: boolean;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const offered = Object.values(PLANS).filter(
    (plan) => plan.id === "free" || plan.teamOnly === !isPersonal,
  );
  const anyProvider = summary.providers.stripe || summary.providers.razorpay;
  const subscribed = summary.provider !== null && summary.status !== "canceled";

  async function choose(plan: Plan, provider: "stripe" | "razorpay") {
    setBusy(`${plan.id}:${provider}`);
    setError(undefined);
    try {
      const url = await api.billing.checkout(workspaceId, {
        plan: plan.id as "pro" | "max" | "team",
        provider,
      });
      if (url) {
        window.location.assign(url);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.billing(workspaceId) });
      toast.success(`Switched to ${plan.name}`);
    } catch (caught) {
      setError(toApiClientError(caught).message);
    }
    setBusy(undefined);
  }

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Plans">
        {offered.map((plan) => {
          const current = plan.id === summary.plan;
          return (
            <li
              key={plan.id}
              className={cn(
                "border-line flex flex-col rounded-xl border p-4",
                current && "border-accent ring-accent/20 ring-2",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold">{plan.name}</h3>
                {current ? (
                  <span className="text-accent text-xs font-medium">Current plan</span>
                ) : null}
              </div>
              <p className="text-muted mt-0.5 text-sm">{price(plan)}</p>
              <ul className="mt-3 flex-1 list-disc space-y-1 pl-5 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              {!current && plan.id !== "free" && summary.canManage ? (
                <div className="mt-4 flex flex-col gap-2">
                  {subscribed ? (
                    <Button
                      className={WRAP}
                      variant="secondary"
                      loading={busy?.startsWith(plan.id)}
                      onClick={() => choose(plan, summary.provider!)}
                    >
                      Switch to {plan.name}
                    </Button>
                  ) : (
                    <>
                      {summary.providers.stripe ? (
                        <Button
                          className={WRAP}
                          loading={busy === `${plan.id}:stripe`}
                          onClick={() => choose(plan, "stripe")}
                        >
                          Upgrade to {plan.name} with a card
                        </Button>
                      ) : null}
                      {summary.providers.razorpay ? (
                        <Button
                          className={WRAP}
                          variant={summary.providers.stripe ? "secondary" : "primary"}
                          loading={busy === `${plan.id}:razorpay`}
                          onClick={() => choose(plan, "razorpay")}
                        >
                          Upgrade to {plan.name} with UPI or an Indian card
                        </Button>
                      ) : null}
                      {!anyProvider ? (
                        <p className="text-muted text-xs">
                          Payments aren&apos;t set up on this server.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ExtraUsage({ summary, workspaceId }: { summary: BillingSummary; workspaceId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(summary.extraUsage.enabled);
  const [cap, setCap] = useState(String(summary.extraUsage.capNanoUsd / USD || 20));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const updated = await api.billing.updateExtraUsage(workspaceId, {
        enabled,
        capUsd: Number(cap) || 0,
      });
      queryClient.setQueryData(queryKeys.billing(workspaceId), updated);
      toast.success(enabled ? "Extra usage is on" : "Extra usage is off");
    } catch (caught) {
      setError(toApiClientError(caught).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-line flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h3 className="text-base font-semibold">Extra usage</h3>
        <p className="text-muted mt-0.5 text-sm">
          Keep working past the limits, billed at cost on your next invoice, up to a monthly cap.
          This month: ${(summary.extraUsage.spentNanoUsd / USD).toFixed(2)}.
        </p>
      </div>
      <FormError message={error} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Turn on extra usage
      </label>
      <TextField
        label="Monthly cap in US dollars"
        type="number"
        min={0}
        step={1}
        inputMode="decimal"
        value={cap}
        disabled={!enabled}
        onChange={(event) => setCap(event.target.value)}
      />
      <Button className="self-start" loading={saving} onClick={save}>
        Save extra usage
      </Button>
    </div>
  );
}

/** Shows a toast when the person comes back from a payment page, then tidies the URL. */
export function BillingReturnNotice({ workspaceId }: { workspaceId: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const result = params.get("billing");
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!result || handled.current === result) return;
    handled.current = result;
    if (result === "success") {
      toast.success("Payment received. Your plan is updating.");
      // The provider's webhook can land a moment after the redirect.
      void queryClient.invalidateQueries({ queryKey: queryKeys.billing(workspaceId) });
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.billing(workspaceId) }),
        2000,
      );
    } else if (result === "cancelled") {
      toast.success("Checkout cancelled. Your plan hasn't changed.");
    }
    router.replace(`${pathname}#plan`, { scroll: false });
  }, [result, router, pathname, queryClient, workspaceId]);
  return null;
}

/** Plan, usage limits, extra usage, and payments for the current workspace. */
export function PlanSection({
  workspaceId,
  isPersonal,
}: {
  workspaceId: string;
  isPersonal: boolean;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const billing = useBilling(workspaceId);
  const [busy, setBusy] = useState(false);

  if (billing.isPending) return <Spinner label="Loading plan" />;
  if (billing.isError)
    return <p className="text-danger text-sm">Your plan couldn&apos;t be loaded.</p>;
  const summary = billing.data;
  const plan = PLANS[summary.plan];
  const periodEnd = summary.currentPeriodEnd
    ? new Date(summary.currentPeriodEnd).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      })
    : null;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (caught) {
      toast.error(toApiClientError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-medium" data-testid="current-plan">
          {plan.name} plan
          {summary.plan === "team" ? `, ${summary.seats} seats` : ""}
        </p>
        <p className="text-muted mt-0.5 text-sm">
          {summary.status === "past_due"
            ? "Your last payment didn't go through. Update your payment details to keep your plan."
            : summary.cancelAtPeriodEnd && periodEnd
              ? `Ends on ${periodEnd}; you'll move to Free then.`
              : periodEnd
                ? `Renews on ${periodEnd}.`
                : plan.description}
        </p>
        {summary.canManage && summary.provider && summary.status !== "canceled" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.provider === "stripe" ? (
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={() =>
                  run(async () => window.location.assign(await api.billing.portal(workspaceId)))
                }
              >
                Payment details and invoices
              </Button>
            ) : null}
            {summary.cancelAtPeriodEnd ? (
              summary.provider === "stripe" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    run(async () => {
                      queryClient.setQueryData(
                        queryKeys.billing(workspaceId),
                        await api.billing.setCancel(workspaceId, false),
                      );
                      toast.success(`You'll stay on ${plan.name}`);
                    })
                  }
                >
                  Keep {plan.name}
                </Button>
              ) : null
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                loading={busy}
                onClick={() =>
                  run(async () => {
                    queryClient.setQueryData(
                      queryKeys.billing(workspaceId),
                      await api.billing.setCancel(workspaceId, true),
                    );
                    toast.success("Your plan will end at the end of this period");
                  })
                }
              >
                Cancel plan
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4" aria-label="Usage limits" role="group">
        <UsageBar label="Five-hour limit" window={summary.usage.session} />
        <UsageBar label="Weekly limit" window={summary.usage.week} />
      </div>

      {summary.canManage && summary.extraUsage.available ? (
        <ExtraUsage
          key={String(summary.extraUsage.enabled)}
          summary={summary}
          workspaceId={workspaceId}
        />
      ) : null}

      <PlanCards summary={summary} workspaceId={workspaceId} isPersonal={isPersonal} />
      {!summary.canManage ? (
        <p className="text-muted text-sm">Owners and admins manage this workspace&apos;s plan.</p>
      ) : null}
    </div>
  );
}
