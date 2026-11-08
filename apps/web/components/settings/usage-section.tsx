"use client";

import { useUsage } from "@tessel/api-client/react";
import type { UsageSummary } from "@tessel/contracts";

const DAYS = 30;

const usd = (amount: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    // Small amounts keep their precision, so a few cheap calls don't show as $0.00.
    maximumFractionDigits: amount > 0 && amount < 1 ? 4 : 2,
  }).format(amount);

const count = (value: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);

function DailyMeter({ label, spend }: { label: string; spend: UsageSummary["today"]["user"] }) {
  const ratio = spend.limitUsd ? Math.min(1, spend.spentUsd / spend.limitUsd) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="text-muted tabular-nums">
          {usd(spend.spentUsd)}
          {spend.limitUsd ? ` of ${usd(spend.limitUsd)}` : ""}
        </span>
      </div>
      {spend.limitUsd ? (
        <div
          role="meter"
          aria-label={`${label} spend`}
          aria-valuemin={0}
          aria-valuemax={spend.limitUsd}
          aria-valuenow={spend.spentUsd}
          aria-valuetext={`${usd(spend.spentUsd)} of ${usd(spend.limitUsd)}`}
          className="bg-line mt-1.5 h-1.5 overflow-hidden rounded-full"
        >
          <div
            className={ratio >= 1 ? "bg-danger h-full" : "bg-accent h-full"}
            style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 2 : 0)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function UsageSection({ workspaceId }: { workspaceId: string }) {
  const usage = useUsage(workspaceId, DAYS);

  if (usage.isPending) return <p className="text-muted text-sm">Loading usage…</p>;
  if (usage.isError)
    return <p className="text-danger text-sm">Usage couldn't be loaded. Refresh to try again.</p>;

  const { totals, byModel, today } = usage.data;
  const resets = new Date(today.resetsAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <DailyMeter label="You today" spend={today.user} />
        <DailyMeter label="Workspace today" spend={today.workspace} />
        <p className="text-muted text-xs">Daily limits reset at {resets}.</p>
      </div>

      {totals.calls === 0 ? (
        <p className="text-muted text-sm">
          No AI usage yet. Each message and background task appears here.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-4">
            <div>
              <dt className="text-muted text-sm">Model calls</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{count(totals.calls)}</dd>
            </div>
            <div>
              <dt className="text-muted text-sm">Tokens</dt>
              <dd className="mt-0.5 font-medium tabular-nums">
                {count(totals.inputTokens + totals.outputTokens)}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-sm">Cost</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{usd(totals.costUsd)}</dd>
            </div>
          </dl>
          <table className="w-full text-sm">
            <caption className="sr-only">Usage by model</caption>
            <thead>
              <tr className="text-muted border-line border-b text-left">
                <th scope="col" className="pb-2 font-normal">
                  Model
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Calls
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((row) => (
                <tr key={row.modelId} className="border-line border-b last:border-b-0">
                  <td className="py-2 pr-3">{row.label}</td>
                  <td className="py-2 text-right tabular-nums">{count(row.calls)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{usd(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
