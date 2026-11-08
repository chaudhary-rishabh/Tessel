import {
  authResponseSchema,
  completionResponseSchema,
  modelListResponseSchema,
  usageSummarySchema,
  publicUserSchema,
  workspaceListResponseSchema,
  workspaceSchema,
  type AuthResponse,
  type ChangePasswordRequest,
  type CompletionRequest,
  type CompletionResponse,
  type ModelListResponse,
  type UsageSummary,
  type LoginRequest,
  type PublicUser,
  type SignupRequest,
  type Workspace,
} from "@tessel/contracts";
import type { z } from "zod";
import type { ApiClient } from "./client";

/**
 * Typed API calls. Every response is validated against the shared contract,
 * so a mismatch between frontend and backend fails loudly in one place.
 */
export function createApi({ http, refreshSession }: ApiClient) {
  const parse = <T extends z.ZodType>(schema: T, data: unknown): z.output<T> => schema.parse(data);

  return {
    auth: {
      signup: async (input: SignupRequest): Promise<AuthResponse> =>
        parse(authResponseSchema, (await http.post("/auth/signup", input)).data),
      login: async (input: LoginRequest): Promise<AuthResponse> =>
        parse(authResponseSchema, (await http.post("/auth/login", input)).data),
      logout: async (): Promise<void> => {
        await http.post("/auth/logout");
      },
      refresh: refreshSession,
    },
    users: {
      me: async (): Promise<PublicUser> =>
        parse(publicUserSchema, (await http.get("/users/me")).data),
      changePassword: async (input: ChangePasswordRequest): Promise<AuthResponse> =>
        parse(authResponseSchema, (await http.post("/users/me/password", input)).data),
    },
    workspaces: {
      list: async (): Promise<Workspace[]> =>
        parse(workspaceListResponseSchema, (await http.get("/workspaces")).data).workspaces,
      create: async (name: string): Promise<Workspace> =>
        parse(workspaceSchema, (await http.post("/workspaces", { name })).data),
      get: async (workspaceId: string): Promise<Workspace> =>
        parse(workspaceSchema, (await http.get(`/workspaces/${workspaceId}`)).data),
      rename: async (workspaceId: string, name: string): Promise<Workspace> =>
        parse(workspaceSchema, (await http.patch(`/workspaces/${workspaceId}`, { name })).data),
    },
    models: {
      list: async (): Promise<ModelListResponse> =>
        parse(modelListResponseSchema, (await http.get("/models")).data),
    },
    ai: {
      complete: async (
        workspaceId: string,
        input: CompletionRequest,
      ): Promise<CompletionResponse> =>
        parse(
          completionResponseSchema,
          (await http.post(`/workspaces/${workspaceId}/completions`, input)).data,
        ),
    },
    usage: {
      summary: async (workspaceId: string, days = 30): Promise<UsageSummary> =>
        parse(
          usageSummarySchema,
          (await http.get(`/workspaces/${workspaceId}/usage`, { params: { days } })).data,
        ),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
