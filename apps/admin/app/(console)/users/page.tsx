"use client";

import { useApi } from "@tessel/api-client/react";
import { Button, Spinner, TextField } from "@tessel/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { ErrorText, PageHeader } from "@/components/page-header";
import { dateTime } from "@/lib/format";

export default function UsersPage() {
  const api = useApi();
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const users = useInfiniteQuery({
    queryKey: ["admin", "users", query],
    queryFn: ({ pageParam }) =>
      api.admin.users({ ...(query ? { query } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = users.data?.pages.flatMap((page) => page.users) ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Users" description="Everyone with a Tessel account, newest first." />
      <div className="mt-6 max-w-sm">
        <TextField
          label="Search by name or email"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="mt-6">
        {users.isPending ? (
          <Spinner label="Loading users" />
        ) : users.isError ? (
          <ErrorText>Users couldn&apos;t be loaded.</ErrorText>
        ) : rows.length === 0 ? (
          <p className="text-muted text-sm">No one matches.</p>
        ) : (
          <div className="border-line overflow-x-auto rounded-xl border">
            <table className="figures w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-paper text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Person
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Last signed in
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-line bg-surface divide-y">
                {rows.map((user) => (
                  <tr key={user.id}>
                    <td className="px-4 py-3">
                      <Link href={`/users/${user.id}`} className="font-medium hover:underline">
                        {user.name}
                      </Link>
                      <p className="text-muted break-all">{user.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      {[
                        user.suspended ? "Suspended" : "Active",
                        user.role === "admin" ? "Admin" : null,
                        user.twoFactorEnabled ? "Two-step on" : null,
                        user.emailVerified ? null : "Email not verified",
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </td>
                    <td className="text-muted px-4 py-3">{dateTime(user.lastLoginAt)}</td>
                    <td className="text-muted px-4 py-3">{dateTime(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {users.hasNextPage ? (
          <Button
            variant="secondary"
            className="mt-4"
            loading={users.isFetchingNextPage}
            onClick={() => users.fetchNextPage()}
          >
            Show more
          </Button>
        ) : null}
      </div>
    </div>
  );
}
