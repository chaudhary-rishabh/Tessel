"use client";

import type {
  AssignableRole,
  CreateInvitationRequest,
  Invitation,
  Member,
  ConnectedApp,
  Identity,
  IdentityProvider,
  PhoneVerifyRequest,
  PublicUser,
  DisableTwoFactorRequest,
  Session,
  TwoFactorSetupResponse,
  Memory,
  MemoryResponse,
  UpdateMemorySettingsRequest,
  AccessToken,
  CreateAccessTokenRequest,
  CreateAccessTokenResponse,
  ConnectorConnection,
  ConnectorListResponse,
  CreateConnectionRequest,
  CreateConnectionResponse,
  CreateSkillRequest,
  UpdateConnectionRequest,
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
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
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
  sessions: ["auth", "sessions"] as const,
  signInOptions: ["auth", "options"] as const,
  connectedApps: ["users", "me", "connected-apps"] as const,
  billing: (workspaceId: string) => ["workspaces", workspaceId, "billing"] as const,
  members: (workspaceId: string) => ["workspaces", workspaceId, "members"] as const,
  invitations: (workspaceId: string) => ["workspaces", workspaceId, "invitations"] as const,
  auditLog: (workspaceId: string) => ["workspaces", workspaceId, "audit-log"] as const,
  identities: ["users", "me", "identities"] as const,
  workspaces: ["workspaces"] as const,
  workspace: (id: string) => ["workspaces", id] as const,
  models: ["models"] as const,
  documents: (workspaceId: string) => ["workspaces", workspaceId, "documents"] as const,
  skills: (workspaceId: string) => ["workspaces", workspaceId, "skills"] as const,
  connectors: (workspaceId: string) => ["workspaces", workspaceId, "connectors"] as const,
  accessTokens: (workspaceId: string) => ["workspaces", workspaceId, "access-tokens"] as const,
  memory: (workspaceId: string) => ["workspaces", workspaceId, "memory"] as const,
  graph: (workspaceId: string, entity: string) =>
    ["workspaces", workspaceId, "graph", entity] as const,
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

/** Drops a workspace the person no longer belongs to from every cached list and query. */
export function forgetWorkspace(queryClient: QueryClient, workspaceId: string) {
  queryClient.setQueryData<Workspace[]>(queryKeys.workspaces, (current = []) =>
    current.filter((item) => item.id !== workspaceId),
  );
  queryClient.removeQueries({ queryKey: ["workspaces", workspaceId] });
}

export function useDeleteWorkspace() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, { workspaceId: string; name: string }>({
    mutationFn: ({ workspaceId, name }) => api.workspaces.remove(workspaceId, name),
    onSuccess: (_result, { workspaceId }) => forgetWorkspace(queryClient, workspaceId),
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

/** Chats whose title or messages contain `q`; idle until there is something to search for. */
export function useThreadSearch(workspaceId: string | undefined, q: string) {
  const api = useApi();
  const text = q.trim();
  return useQuery({
    queryKey: [...queryKeys.threads(workspaceId ?? "none"), "search", text] as const,
    queryFn: () => api.chat.threads(workspaceId!, { q: text }),
    enabled: Boolean(workspaceId) && text.length > 0,
    placeholderData: (previous) => previous,
  });
}

/** Loads the next page of older chats onto the end of the cached chat list. */
export function useLoadOlderThreads(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<ThreadListResponse, ApiClientError, string>({
    mutationFn: (before) => api.chat.threads(workspaceId, { before }),
    onSuccess: (page) => {
      queryClient.setQueryData<ThreadListResponse>(queryKeys.threads(workspaceId), (current) => {
        if (!current) return page;
        const seen = new Set(current.threads.map((thread) => thread.id));
        return {
          threads: [...current.threads, ...page.threads.filter((thread) => !seen.has(thread.id))],
          nextCursor: page.nextCursor,
        };
      });
    },
  });
}

/**
 * Applies a change to every cached list of chats in a workspace: the sidebar
 * list and any search results. A single chat's own query is left alone.
 */
export function updateThreadLists(
  queryClient: QueryClient,
  workspaceId: string,
  update: (threads: ThreadSummary[]) => ThreadSummary[],
) {
  const [, , scope] = queryKeys.threads(workspaceId);
  queryClient.setQueriesData<ThreadListResponse>(
    {
      queryKey: queryKeys.threads(workspaceId),
      // ["workspaces", id, "threads"] is the list, [..., "search", q] a search.
      predicate: ({ queryKey }) =>
        queryKey[2] === scope && (queryKey.length === 3 || queryKey[3] === "search"),
    },
    (current) => (current ? { ...current, threads: update(current.threads) } : current),
  );
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
      updateThreadLists(queryClient, workspaceId, (threads) =>
        threads.map((item) => (item.id === thread.id ? thread : item)),
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
      updateThreadLists(queryClient, workspaceId, (threads) =>
        threads.filter((item) => item.id !== threadId),
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

export function useConnectors(workspaceId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.connectors(workspaceId ?? "none"),
    queryFn: () => api.connectors.list(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

function putConnection(
  current: ConnectorListResponse | undefined,
  connection: ConnectorConnection,
): ConnectorListResponse | undefined {
  if (!current) return current;
  const exists = current.connections.some((item) => item.id === connection.id);
  return {
    ...current,
    connections: exists
      ? current.connections.map((item) => (item.id === connection.id ? connection : item))
      : [...current.connections, connection],
  };
}

export function useCreateConnection(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<CreateConnectionResponse, ApiClientError, CreateConnectionRequest>({
    mutationFn: (input) => api.connectors.create(workspaceId, input),
    onSuccess: ({ connection }) =>
      queryClient.setQueryData<ConnectorListResponse>(
        queryKeys.connectors(workspaceId),
        (current) => putConnection(current, connection),
      ),
  });
}

export function useRefreshConnection(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<CreateConnectionResponse, ApiClientError, string>({
    mutationFn: (connectionId) => api.connectors.refresh(workspaceId, connectionId),
    onSuccess: ({ connection }) =>
      queryClient.setQueryData<ConnectorListResponse>(
        queryKeys.connectors(workspaceId),
        (current) => putConnection(current, connection),
      ),
  });
}

export function useUpdateConnection(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<
    ConnectorConnection,
    ApiClientError,
    { connectionId: string; input: UpdateConnectionRequest }
  >({
    mutationFn: ({ connectionId, input }) =>
      api.connectors.update(workspaceId, connectionId, input),
    onSuccess: (connection) =>
      queryClient.setQueryData<ConnectorListResponse>(
        queryKeys.connectors(workspaceId),
        (current) => putConnection(current, connection),
      ),
  });
}

export function useDeleteConnection(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, string>({
    mutationFn: (connectionId) => api.connectors.remove(workspaceId, connectionId),
    onSuccess: (_result, connectionId) =>
      queryClient.setQueryData<ConnectorListResponse>(
        queryKeys.connectors(workspaceId),
        (current) =>
          current
            ? {
                ...current,
                connections: current.connections.filter((item) => item.id !== connectionId),
              }
            : current,
      ),
  });
}

export function useAccessTokens(workspaceId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.accessTokens(workspaceId ?? "none"),
    queryFn: () => api.accessTokens.list(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateAccessToken(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<CreateAccessTokenResponse, ApiClientError, CreateAccessTokenRequest>({
    mutationFn: (input) => api.accessTokens.create(workspaceId, input),
    onSuccess: ({ accessToken }) =>
      queryClient.setQueryData<AccessToken[]>(queryKeys.accessTokens(workspaceId), (current) =>
        current ? [accessToken, ...current] : current,
      ),
  });
}

export function useRevokeAccessToken(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, string>({
    mutationFn: (tokenId) => api.accessTokens.revoke(workspaceId, tokenId),
    onSuccess: (_result, tokenId) =>
      queryClient.setQueryData<AccessToken[]>(queryKeys.accessTokens(workspaceId), (current) =>
        current?.filter((token) => token.id !== tokenId),
      ),
  });
}

export function useMemory(workspaceId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.memory(workspaceId ?? "none"),
    queryFn: () => api.memory.get(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useMemoryActions(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = queryKeys.memory(workspaceId);
  const patch = (update: (current: MemoryResponse) => MemoryResponse) =>
    queryClient.setQueryData<MemoryResponse>(key, (current) =>
      current ? update(current) : current,
    );
  const put = (memory: Memory) =>
    patch((current) => ({
      ...current,
      memories: current.memories.some((item) => item.id === memory.id)
        ? current.memories.map((item) => (item.id === memory.id ? memory : item))
        : [memory, ...current.memories],
    }));
  return {
    saveSettings: useMutation<
      MemoryResponse["settings"],
      ApiClientError,
      UpdateMemorySettingsRequest
    >({
      mutationFn: (input) => api.memory.saveSettings(workspaceId, input),
      onSuccess: (settings) => patch((current) => ({ ...current, settings })),
    }),
    add: useMutation<Memory, ApiClientError, string>({
      mutationFn: (content) => api.memory.add(workspaceId, content),
      onSuccess: put,
    }),
    update: useMutation<Memory, ApiClientError, { memoryId: string; content: string }>({
      mutationFn: ({ memoryId, content }) => api.memory.update(workspaceId, memoryId, content),
      onSuccess: put,
    }),
    remove: useMutation<void, ApiClientError, string>({
      mutationFn: (memoryId) => api.memory.remove(workspaceId, memoryId),
      onSuccess: (_result, memoryId) =>
        patch((current) => ({
          ...current,
          memories: current.memories.filter((item) => item.id !== memoryId),
        })),
    }),
    clear: useMutation<void, ApiClientError, void>({
      mutationFn: () => api.memory.clear(workspaceId),
      onSuccess: () => patch((current) => ({ ...current, memories: [] })),
    }),
  };
}

export function useGraph(workspaceId: string | undefined, entity = "") {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.graph(workspaceId ?? "none", entity),
    queryFn: () => api.graph.explore(workspaceId!, entity || undefined),
    enabled: Boolean(workspaceId),
  });
}

export function useSessions() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.sessions, queryFn: api.auth.sessions });
}

export function useRevokeSession() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, string>({
    mutationFn: (sessionId) => api.auth.revokeSession(sessionId),
    onSuccess: (_result, sessionId) =>
      queryClient.setQueryData<Session[]>(queryKeys.sessions, (current) =>
        current?.filter((session) => session.id !== sessionId),
      ),
  });
}

/** Two-step sign-in changes refresh the user, whose `twoFactorEnabled` they flip. */
export function useTwoFactorActions() {
  const api = useApi();
  const queryClient = useQueryClient();
  const refreshMe = () => queryClient.invalidateQueries({ queryKey: queryKeys.me });
  return {
    setup: useMutation<TwoFactorSetupResponse, ApiClientError, void>({
      mutationFn: () => api.users.twoFactor.setup(),
    }),
    enable: useMutation<string[], ApiClientError, string>({
      mutationFn: (code) => api.users.twoFactor.enable(code),
      onSuccess: refreshMe,
    }),
    disable: useMutation<void, ApiClientError, DisableTwoFactorRequest>({
      mutationFn: (input) => api.users.twoFactor.disable(input),
      onSuccess: refreshMe,
    }),
    regenerate: useMutation<string[], ApiClientError, string>({
      mutationFn: (code) => api.users.twoFactor.regenerateRecoveryCodes(code),
    }),
  };
}

export function useSignInOptions() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.signInOptions,
    queryFn: api.auth.options,
    staleTime: 5 * 60_000,
  });
}

export function useIdentities() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.identities, queryFn: api.users.identities });
}

export function useUnlinkIdentity() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, IdentityProvider>({
    mutationFn: (provider) => api.users.unlinkIdentity(provider),
    onSuccess: (_result, provider) =>
      queryClient.setQueryData<Identity[]>(queryKeys.identities, (current) =>
        current?.filter((identity) => identity.provider !== provider),
      ),
  });
}

/** Adding, confirming, and removing the phone number used for signing in. */
export function usePhoneActions() {
  const api = useApi();
  const queryClient = useQueryClient();
  const setMe = (user: PublicUser) => queryClient.setQueryData(queryKeys.me, user);
  return {
    add: useMutation({ mutationFn: (phone: string) => api.users.addPhone(phone) }),
    confirm: useMutation<PublicUser, ApiClientError, PhoneVerifyRequest>({
      mutationFn: (input) => api.users.confirmPhone(input),
      onSuccess: setMe,
    }),
    remove: useMutation<PublicUser, ApiClientError, void>({
      mutationFn: () => api.users.removePhone(),
      onSuccess: setMe,
    }),
  };
}

export function useConnectedApps() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.connectedApps, queryFn: api.oauth.apps });
}

export function useDisconnectApp() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, string>({
    mutationFn: (appId) => api.oauth.disconnect(appId),
    onSuccess: (_result, appId) =>
      queryClient.setQueryData<ConnectedApp[]>(queryKeys.connectedApps, (current) =>
        current?.filter((app) => app.id !== appId),
      ),
  });
}

export function useMembers(workspaceId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.members(workspaceId ?? "none"),
    queryFn: () => api.members.list(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useInvitations(workspaceId: string | undefined, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.invitations(workspaceId ?? "none"),
    queryFn: () => api.members.invitations(workspaceId!),
    enabled: Boolean(workspaceId) && enabled,
  });
}

/** Member and invitation changes, keeping both lists and the audit log fresh. */
export function useMemberActions(workspaceId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.members(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.invitations(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auditLog(workspaceId) }),
    ]);
  return {
    invite: useMutation<Invitation, ApiClientError, CreateInvitationRequest>({
      mutationFn: (input) => api.members.invite(workspaceId, input),
      onSuccess: refresh,
    }),
    revokeInvitation: useMutation<void, ApiClientError, string>({
      mutationFn: (invitationId) => api.members.revokeInvitation(workspaceId, invitationId),
      onSuccess: refresh,
    }),
    updateRole: useMutation<Member, ApiClientError, { userId: string; role: AssignableRole }>({
      mutationFn: ({ userId, role }) => api.members.updateRole(workspaceId, userId, role),
      onSuccess: refresh,
    }),
    remove: useMutation<void, ApiClientError, string>({
      mutationFn: (userId) => api.members.remove(workspaceId, userId),
      onSuccess: async (_result, userId) => {
        // Leaving: the workspace is gone from this person's list straight away.
        if (userId === queryClient.getQueryData<PublicUser>(queryKeys.me)?.id) {
          forgetWorkspace(queryClient, workspaceId);
          return;
        }
        await refresh();
      },
    }),
    transfer: useMutation<void, ApiClientError, string>({
      mutationFn: (userId) => api.members.transferOwnership(workspaceId, userId),
      onSuccess: async () => {
        await refresh();
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces, exact: true });
      },
    }),
  };
}

/** The workspace's audit log, newest first, a page at a time. */
export function useAuditLog(workspaceId: string | undefined) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.auditLog(workspaceId ?? "none"),
    queryFn: ({ pageParam }) => api.members.auditLog(workspaceId!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    enabled: Boolean(workspaceId),
  });
}

export function useBilling(workspaceId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.billing(workspaceId ?? "none"),
    queryFn: () => api.billing.summary(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}
