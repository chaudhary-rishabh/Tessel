"use client";

import { useApi } from "@tessel/api-client/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { count, dollars } from "@/lib/format";

function Figure({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="border-line bg-surface rounded-xl border p-5">
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="figures font-display mt-2 text-3xl font-semibold">{value}</dd>
      {detail ? <dd className="text-muted mt-1 text-xs">{detail}</dd> : null}
    </div>
  );
}

export default function OverviewPage() {
  const api = useApi();
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: api.admin.overview });
  if (!overview.data) return null;
  const data = overview.data;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Overview" description="This Tessel deployment at a glance." />
      <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Figures">
        <Figure
          label="People"
          value={count(data.users)}
          detail={`${count(data.activeUsers7d)} signed in this week, ${count(data.newUsers7d)} new`}
        />
        <Figure
          label="Workspaces"
          value={count(data.workspaces)}
          detail={`${count(data.teamWorkspaces)} team workspaces`}
        />
        <Figure label="Documents" value={count(data.documents)} />
        <Figure label="AI spend today" value={dollars(data.costTodayNanoUsd)} />
        <Figure
          label="AI spend, 30 days"
          value={dollars(data.cost30dNanoUsd)}
          detail={`${count(data.calls30d)} model calls`}
        />
        <Figure label="Suspended accounts" value={count(data.suspendedUsers)} />
      </dl>
      <p className="text-muted mt-8 text-sm">
        See{" "}
        <Link href="/usage" className="text-accent underline-offset-4 hover:underline">
          usage
        </Link>{" "}
        for spend by model and by workspace.
      </p>
    </div>
  );
}
