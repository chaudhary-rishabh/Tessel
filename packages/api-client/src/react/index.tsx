"use client";

import type {
  CreateSkillRequest,
  DocumentSummary,
  Skill,
  UpdateSkillRequest,
  ModelListResponse,
  ThreadListResponse,
  ThreadResponse,
  ThreadSummary,
  UsageSummary,
  Workspace,
} from "@tessel/contracts";
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
  documents: (workspaceId: string) => ["workspaces", workspaceId, "documents"] as const,
  skills: (workspaceId: string) => ["workspaces", workspaceId, "skills"] as const,
  threads: (workspaceId: string) => ["workspaces", workspaceId, "threads"] as const,
  thread: (workspaceId: string, threadId: string) =>
    ["workspaces", workspaceId, "threads", threadId] as const,
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

export function useThreads(
  workspaceId: string | undefined,
  options: QueryOptions<ThreadListResponse> = {},
) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.threads(workspaceId ?? "none"),
    queryFn: () => api.chat.threads(workspaceId!),
    enabled: Boolean(workspaceId),
    ...options,
  });
}

export function useThread(
  workspaceId: string | undefined,
  threadId: string | undefined,
  options: QueryOptions<ThreadResponse> = {},
) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.thread(workspaceId ?? "none", threadId ?? "none"),
    queryFn: () => api.chat.thread(workspaceId!, threadId!),
    enabled: Boolean(workspaceId && threadId),
    ...options,
  });
}

/** Puts a thread at the top of the cached chat list, adding or updating it. */
export function upsertThreadInList(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  thread: ThreadSummary,
) {
  queryClient.setQueryData<ThreadListResponse>(queryKeys.threads(workspaceId), (current) => {
    if (!current) return current;
    const rest = current.threads.filter((item) => item.id !== thread.id);
    return { ...current, threads: [thread, ...rest] };
  });
}

export function useRenameThread(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<ThreadSummary, ApiClientError, { threadId: string; title: string }>({
    mutationFn: ({ threadId, title }) => api.chat.rename(workspaceId, threadId, title),
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadListResponse>(queryKeys.threads(workspaceId), (current) =>
        current
          ? {
              ...current,
              threads: current.threads.map((item) => (item.id === thread.id ? thread : item)),
            }
          : current,
      );
      queryClient.setQueryData<ThreadResponse>(
        queryKeys.thread(workspaceId, thread.id),
        (current) => (current ? { ...current, thread } : current),
      );
    },
  });
}

export function useDeleteThread(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, string>({
    mutationFn: (threadId) => api.chat.remove(workspaceId, threadId),
    onSuccess: (_result, threadId) => {
      queryClient.setQueryData<ThreadListResponse>(queryKeys.threads(workspaceId), (current) =>
        current
          ? { ...current, threads: current.threads.filter((item) => item.id !== threadId) }
          : current,
      );
      queryClient.removeQueries({ queryKey: queryKeys.thread(workspaceId, threadId) });
    },
  });
}

const PROCESSING: ReadonlySet<DocumentSummary["status"]> = new Set([
  "uploading",
  "queued",
  "processing",
]);

/** The workspace's documents. Polls while any of them is still being processed. */
export function useDocuments(workspaceId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.documents(workspaceId ?? "none"),
    queryFn: () => api.documents.list(workspaceId!),
    enabled: Boolean(workspaceId),
    refetchInterval: (query) =>
      query.state.data?.some((document) => PROCESSING.has(document.status)) ? 2_000 : false,
  });
}

export function useDeleteDocument(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, string>({
    mutationFn: (documentId) => api.documents.remove(workspaceId, documentId),
    onSuccess: (_result, documentId) =>
      queryClient.setQueryData<DocumentSummary[]>(queryKeys.documents(workspaceId), (current) =>
        current?.filter((document) => document.id !== documentId),
      ),
  });
}

export function useReprocessDocument(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<DocumentSummary, ApiClientError, string>({
    mutationFn: (documentId) => api.documents.reprocess(workspaceId, documentId),
    onSuccess: (document) =>
      queryClient.setQueryData<DocumentSummary[]>(queryKeys.documents(workspaceId), (current) =>
        current?.map((item) => (item.id === document.id ? document : item)),
      ),
  });
}

export function useSkills(workspaceId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.skills(workspaceId ?? "none"),
    queryFn: () => api.skills.list(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

/** Workspace skills first (newest edits applied in place), then built-in ones. */
function putSkill(skills: Skill[] | undefined, skill: Skill): Skill[] | undefined {
  if (!skills) return skills;
  return skills.some((item) => item.id === skill.id)
    ? skills.map((item) => (item.id === skill.id ? skill : item))
    : [skill, ...skills];
}

export function useCreateSkill(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Skill, ApiClientError, CreateSkillRequest>({
    mutationFn: (input) => api.skills.create(workspaceId, input),
    onSuccess: (skill) =>
      queryClient.setQueryData<Skill[]>(queryKeys.skills(workspaceId), (current) =>
        putSkill(current, skill),
      ),
  });
}

export function useUpdateSkill(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Skill, ApiClientError, { skillId: string; input: UpdateSkillRequest }>({
    mutationFn: ({ skillId, input }) => api.skills.update(workspaceId, skillId, input),
    onSuccess: (skill) =>
      queryClient.setQueryData<Skill[]>(queryKeys.skills(workspaceId), (current) =>
        putSkill(current, skill),
      ),
  });
}

export function useDeleteSkill(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, string>({
    mutationFn: (skillId) => api.skills.remove(workspaceId, skillId),
    onSuccess: (_result, skillId) =>
      queryClient.setQueryData<Skill[]>(queryKeys.skills(workspaceId), (current) =>
        current?.filter((skill) => skill.id !== skillId),
      ),
  });
}
