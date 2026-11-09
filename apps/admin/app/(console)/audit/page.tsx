"use client";

import { useApi } from "@tessel/api-client/react";
import { Button, Spinner } from "@tessel/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { AuditList } from "@/components/audit-list";
import { ErrorText, PageHeader } from "@/components/page-header";
import { AUDIT_FILTERS } from "@/lib/audit";

export default function AuditPage() {
  const api = useApi();
  const filterId = useId();
  const [action, setAction] = useState("");
  const log = useInfiniteQuery({
    queryKey: ["admin", "audit", action],
    queryFn: ({ pageParam }) =>
      api.admin.auditLog({
        ...(action ? { action } : {}),
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Audit log"
        description="Security changes, membership, tokens, and admin actions across every workspace. Kept for a year."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor={filterId} className="text-sm font-medium">
              Show
            </label>
            <select
              id={filterId}
              value={action}
              onChange={(event) => setAction(event.target.value)}
              className="border-line bg-surface h-9 rounded-lg border px-2 text-sm"
            >
              {AUDIT_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <div className="mt-6">
        {log.isPending ? (
          <Spinner label="Loading the audit log" />
        ) : log.isError ? (
          <ErrorText>The audit log couldn&apos;t be loaded.</ErrorText>
        ) : (
          <AuditList events={log.data.pages.flatMap((page) => page.events)} />
        )}
        {log.hasNextPage ? (
          <Button
            variant="secondary"
            className="mt-4"
            loading={log.isFetchingNextPage}
            onClick={() => log.fetchNextPage()}
          >
            Show older
          </Button>
        ) : null}
      </div>
    </div>
  );
}
