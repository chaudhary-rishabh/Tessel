"use client";

import type { ModelListResponse, UsageSummary, Workspace } from "@tessel/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import type { Api } from "../endpoints";
import type { ApiClientError } from "../errors";

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext value={api}>{children}</ApiContext>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used inside <ApiProvider>");
  return api;
}

/** One place for cache keys, so invalidation can't drift from the queries that use them. */
export const queryKeys = {
  me: ["users", "me"] as const,
  workspaces: ["workspaces"] as const,
  workspace: (id: string) => ["workspaces", id] as const,
  models: ["models"] as const,
  usage: (workspaceId: string, days: number) => ["workspaces", workspaceId, "usage", days] as const,
};

type QueryOptions<T> = Omit<UseQueryOptions<T, ApiClientError>, "queryKey" | "queryFn">;

export function useMe(options: QueryOptions<Awaited<ReturnType<Api["users"]["me"]>>> = {}) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.me, queryFn: api.users.me, ...options });
}

export function useWorkspaces(options: QueryOptions<Workspace[]> = {}) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.workspaces, queryFn: api.workspaces.list, ...options });
}

export function useCreateWorkspace() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Workspace, ApiClientError, string>({
    mutationFn: (name) => api.workspaces.create(name),
    onSuccess: (workspace) => {
      queryClient.setQueryData<Workspace[]>(queryKeys.workspaces, (current = []) => [
        ...current,
        workspace,
      ]);
    },
  });
}

export function useRenameWorkspace() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Workspace, ApiClientError, { workspaceId: string; name: string }>({
    mutationFn: ({ workspaceId, name }) => api.workspaces.rename(workspaceId, name),
    onSuccess: (workspace) => {
      queryClient.setQueryData<Workspace[]>(queryKeys.workspaces, (current = []) =>
        current.map((item) => (item.id === workspace.id ? workspace : item)),
      );
      queryClient.setQueryData(queryKeys.workspace(workspace.id), workspace);
    },
  });
}

export function useModels(options: QueryOptions<ModelListResponse> = {}) {
  const api = useApi();
  // The model list changes only on deploys.
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: api.models.list,
    staleTime: 10 * 60_000,
    ...options,
  });
}

export function useUsage(
  workspaceId: string | undefined,
  days = 30,
  options: QueryOptions<UsageSummary> = {},
) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.usage(workspaceId ?? "none", days),
    queryFn: () => api.usage.summary(workspaceId!, days),
    enabled: Boolean(workspaceId),
    ...options,
  });
}
