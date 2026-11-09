"use client";

import { useApi } from "@tessel/api-client/react";
import { Spinner } from "@tessel/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { count, dollars } from "@/lib/format";

function Table({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | React.ReactNode)[][];
}) {
  return (
    <div className="border-line overflow-x-auto rounded-xl border">
      <table className="figures bg-surface w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-paper text-muted">
          <tr>
            {head.map((label, index) => (
              <th
                key={label}
                scope="col"
                className={`px-4 py-2.5 font-medium ${index > 0 ? "text-right" : ""}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="text-muted px-4 py-3">
                No usage in this period.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, at) => (
                  <td key={at} className={`px-4 py-2.5 ${at > 0 ? "text-right" : ""}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function UsagePage() {
  const api = useApi();
  const periodId = useId();
  const [days, setDays] = useState(30);
  const usage = useQuery({
    queryKey: ["admin", "usage", days],
    queryFn: () => api.admin.usage(days),
  });
  const data = usage.data;
  const peak = Math.max(1, ...(data?.days.map((day) => day.costNanoUsd) ?? [1]));
  const total = data?.days.reduce((sum, day) => sum + day.costNanoUsd, 0) ?? 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Usage"
        description="AI spend from the usage ledger, which records every model call."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor={periodId} className="text-sm font-medium">
              Period
            </label>
            <select
              id={periodId}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="border-line bg-surface h-9 rounded-lg border px-2 text-sm"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
        }
      />
      {!data ? (
        <div className="mt-8">
          <Spinner label="Loading usage" />
        </div>
      ) : (
        <>
          <p className="figures font-display mt-8 text-3xl font-semibold">{dollars(total)}</p>
          <p className="text-muted text-sm">in the last {days} days</p>
          {data.days.length > 0 ? (
            <div className="mt-6 flex h-32 items-end gap-1" aria-hidden="true">
              {data.days.map((day) => (
                <div
                  key={day.day}
                  title={`${day.day}: ${dollars(day.costNanoUsd)}`}
                  className="bg-accent min-w-1 flex-1 rounded-t"
                  style={{ height: `${Math.max(2, (day.costNanoUsd / peak) * 100)}%` }}
                />
              ))}
            </div>
          ) : null}

          <section aria-labelledby="by-model" className="mt-10">
            <h2 id="by-model" className="text-lg font-semibold">
              By model
            </h2>
            <div className="mt-3">
              <Table
                caption="Spend by model"
                head={["Model", "Calls", "Input tokens", "Output tokens", "Spend"]}
                rows={data.models.map((model) => [
                  model.modelId,
                  count(model.calls),
                  count(model.inputTokens),
                  count(model.outputTokens),
                  dollars(model.costNanoUsd),
                ])}
              />
            </div>
          </section>
          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            <section aria-labelledby="by-workspace">
              <h2 id="by-workspace" className="text-lg font-semibold">
                Top workspaces
              </h2>
              <div className="mt-3">
                <Table
                  caption="Top workspaces by spend"
                  head={["Workspace", "Calls", "Spend"]}
                  rows={data.topWorkspaces.map((row) => [
                    row.name,
                    count(row.calls),
                    dollars(row.costNanoUsd),
                  ])}
                />
              </div>
            </section>
            <section aria-labelledby="by-user">
              <h2 id="by-user" className="text-lg font-semibold">
                Top people
              </h2>
              <div className="mt-3">
                <Table
                  caption="Top people by spend"
                  head={["Person", "Calls", "Spend"]}
                  rows={data.topUsers.map((row) => [
                    <Link key={row.id} href={`/users/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>,
                    count(row.calls),
                    dollars(row.costNanoUsd),
                  ])}
                />
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
