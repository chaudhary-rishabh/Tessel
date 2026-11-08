import {
  authResponseSchema,
  completionResponseSchema,
  modelListResponseSchema,
  usageSummarySchema,
  attachmentSchema,
  threadListResponseSchema,
  threadResponseSchema,
  threadSummarySchema,
  publicUserSchema,
  workspaceListResponseSchema,
  workspaceSchema,
  type AuthResponse,
  type ChangePasswordRequest,
  type CompletionRequest,
  type CompletionResponse,
  type ModelListResponse,
  type UsageSummary,
  type Attachment,
  type ThreadListResponse,
  type ThreadResponse,
  type ThreadSummary,
  type LoginRequest,
  type PublicUser,
  type SignupRequest,
  type Workspace,
} from "@tessel/contracts";
import type { z } from "zod";
import type { ApiClient } from "./client";
import { createChatStream } from "./stream";

/**
 * Typed API calls. Every response is validated against the shared contract,
 * so a mismatch between frontend and backend fails loudly in one place.
 */
export function createApi(client: ApiClient) {
  const { http, refreshSession } = client;
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
    chat: {
      /** Sends a message and streams the reply. See ChatEvent for the event order. */
      send: createChatStream(client),
      threads: async (workspaceId: string, before?: string): Promise<ThreadListResponse> =>
        parse(
          threadListResponseSchema,
          (await http.get(`/workspaces/${workspaceId}/threads`, { params: { before } })).data,
        ),
      thread: async (workspaceId: string, threadId: string): Promise<ThreadResponse> =>
        parse(
          threadResponseSchema,
          (await http.get(`/workspaces/${workspaceId}/threads/${threadId}`)).data,
        ),
      rename: async (
        workspaceId: string,
        threadId: string,
        title: string,
      ): Promise<ThreadSummary> =>
        parse(
          threadSummarySchema,
          (await http.patch(`/workspaces/${workspaceId}/threads/${threadId}`, { title })).data,
        ),
      remove: async (workspaceId: string, threadId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/threads/${threadId}`);
      },
      upload: async (
        workspaceId: string,
        file: Blob,
        filename: string,
        onProgress?: (fraction: number) => void,
      ): Promise<Attachment> => {
        const form = new FormData();
        form.append("file", file, filename);
        const response = await http.post(`/workspaces/${workspaceId}/attachments`, form, {
          timeout: 120_000,
          onUploadProgress: (event) => {
            if (event.total) onProgress?.(event.loaded / event.total);
          },
        });
        return parse(attachmentSchema, response.data);
      },
      /** File contents as a Blob, for previews (img tags can't send the auth header). */
      attachmentBlob: async (workspaceId: string, attachmentId: string): Promise<Blob> =>
        (
          await http.get<Blob>(`/workspaces/${workspaceId}/attachments/${attachmentId}/content`, {
            responseType: "blob",
          })
        ).data,
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
