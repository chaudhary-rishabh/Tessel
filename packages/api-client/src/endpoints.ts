import {
  authResponseSchema,
  completionResponseSchema,
  modelListResponseSchema,
  usageSummarySchema,
  attachmentSchema,
  createDocumentResponseSchema,
  documentListResponseSchema,
  documentSchema,
  downloadResponseSchema,
  searchResponseSchema,
  skillListResponseSchema,
  memoryResponseSchema,
  memorySchema,
  memorySettingsSchema,
  accessTokenListResponseSchema,
  createAccessTokenResponseSchema,
  connectorConnectionSchema,
  connectorListResponseSchema,
  createConnectionResponseSchema,
  skillSchema,
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
  type DocumentSummary,
  type PresignedUpload,
  type SearchRequest,
  type SearchResponse,
  type CreateSkillRequest,
  type Memory,
  type MemoryResponse,
  type MemorySettings,
  type UpdateMemorySettingsRequest,
  type AccessToken,
  type CreateAccessTokenRequest,
  type CreateAccessTokenResponse,
  type ConnectorConnection,
  type ConnectorListResponse,
  type CreateConnectionRequest,
  type CreateConnectionResponse,
  type UpdateConnectionRequest,
  type Skill,
  type UpdateSkillRequest,
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
import { ApiClientError } from "./errors";
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
      /** send streams a reply; decide continues one waiting on a tool call. See ChatEvent. */
      ...createChatStream(client),
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
    memory: {
      get: async (workspaceId: string): Promise<MemoryResponse> =>
        parse(memoryResponseSchema, (await http.get(`/workspaces/${workspaceId}/memory`)).data),
      saveSettings: async (
        workspaceId: string,
        input: UpdateMemorySettingsRequest,
      ): Promise<MemorySettings> =>
        parse(
          memorySettingsSchema,
          (await http.put(`/workspaces/${workspaceId}/memory/settings`, input)).data,
        ),
      add: async (workspaceId: string, content: string): Promise<Memory> =>
        parse(
          memorySchema,
          (await http.post(`/workspaces/${workspaceId}/memory/memories`, { content })).data,
        ),
      update: async (workspaceId: string, memoryId: string, content: string): Promise<Memory> =>
        parse(
          memorySchema,
          (await http.patch(`/workspaces/${workspaceId}/memory/memories/${memoryId}`, { content }))
            .data,
        ),
      remove: async (workspaceId: string, memoryId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/memory/memories/${memoryId}`);
      },
      clear: async (workspaceId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/memory/memories`);
      },
    },
    accessTokens: {
      list: async (workspaceId: string): Promise<AccessToken[]> =>
        parse(
          accessTokenListResponseSchema,
          (await http.get(`/workspaces/${workspaceId}/access-tokens`)).data,
        ).tokens,
      /** The response holds the token itself; it can't be fetched again. */
      create: async (
        workspaceId: string,
        input: CreateAccessTokenRequest,
      ): Promise<CreateAccessTokenResponse> =>
        parse(
          createAccessTokenResponseSchema,
          (await http.post(`/workspaces/${workspaceId}/access-tokens`, input)).data,
        ),
      revoke: async (workspaceId: string, tokenId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/access-tokens/${tokenId}`);
      },
    },
    connectors: {
      list: async (workspaceId: string): Promise<ConnectorListResponse> =>
        parse(
          connectorListResponseSchema,
          (await http.get(`/workspaces/${workspaceId}/connectors`)).data,
        ),
      /** For OAuth apps the response includes the sign-in URL to send the browser to. */
      create: async (
        workspaceId: string,
        input: CreateConnectionRequest,
      ): Promise<CreateConnectionResponse> =>
        parse(
          createConnectionResponseSchema,
          (await http.post(`/workspaces/${workspaceId}/connectors`, input)).data,
        ),
      refresh: async (
        workspaceId: string,
        connectionId: string,
      ): Promise<CreateConnectionResponse> =>
        parse(
          createConnectionResponseSchema,
          (await http.post(`/workspaces/${workspaceId}/connectors/${connectionId}/refresh`)).data,
        ),
      update: async (
        workspaceId: string,
        connectionId: string,
        input: UpdateConnectionRequest,
      ): Promise<ConnectorConnection> =>
        parse(
          connectorConnectionSchema,
          (await http.patch(`/workspaces/${workspaceId}/connectors/${connectionId}`, input)).data,
        ),
      remove: async (workspaceId: string, connectionId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/connectors/${connectionId}`);
      },
    },
    skills: {
      list: async (workspaceId: string): Promise<Skill[]> =>
        parse(skillListResponseSchema, (await http.get(`/workspaces/${workspaceId}/skills`)).data)
          .skills,
      create: async (workspaceId: string, input: CreateSkillRequest): Promise<Skill> =>
        parse(skillSchema, (await http.post(`/workspaces/${workspaceId}/skills`, input)).data),
      update: async (
        workspaceId: string,
        skillId: string,
        input: UpdateSkillRequest,
      ): Promise<Skill> =>
        parse(
          skillSchema,
          (await http.patch(`/workspaces/${workspaceId}/skills/${skillId}`, input)).data,
        ),
      remove: async (workspaceId: string, skillId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/skills/${skillId}`);
      },
    },
    documents: {
      list: async (workspaceId: string): Promise<DocumentSummary[]> =>
        parse(
          documentListResponseSchema,
          (await http.get(`/workspaces/${workspaceId}/documents`)).data,
        ).documents,
      /**
       * Uploads a file straight to storage: register it, PUT the bytes to the
       * presigned URL (with progress), then tell the API the upload is done.
       */
      upload: async (
        workspaceId: string,
        file: File,
        onProgress?: (fraction: number) => void,
      ): Promise<DocumentSummary> => {
        const base = `/workspaces/${workspaceId}/documents`;
        const { document, upload } = parse(
          createDocumentResponseSchema,
          (await http.post(base, { filename: file.name, sizeBytes: file.size })).data,
        );
        await putToStorage(upload, file, onProgress);
        return parse(documentSchema, (await http.post(`${base}/${document.id}/complete`)).data);
      },
      reprocess: async (workspaceId: string, documentId: string): Promise<DocumentSummary> =>
        parse(
          documentSchema,
          (await http.post(`/workspaces/${workspaceId}/documents/${documentId}/reprocess`)).data,
        ),
      remove: async (workspaceId: string, documentId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/documents/${documentId}`);
      },
      downloadUrl: async (workspaceId: string, documentId: string): Promise<string> =>
        parse(
          downloadResponseSchema,
          (await http.get(`/workspaces/${workspaceId}/documents/${documentId}/download`)).data,
        ).url,
      search: async (workspaceId: string, input: SearchRequest): Promise<SearchResponse> =>
        parse(
          searchResponseSchema,
          (await http.post(`/workspaces/${workspaceId}/search`, input)).data,
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

/**
 * PUTs a file to a presigned storage URL. XMLHttpRequest rather than fetch,
 * because fetch can't report upload progress.
 */
function putToStorage(
  upload: PresignedUpload,
  file: Blob,
  onProgress?: (fraction: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers))
      request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(
            new ApiClientError(
              request.status,
              "upload_failed",
              "The file couldn't be uploaded. Try again.",
            ),
          );
    request.onerror = () =>
      reject(
        new ApiClientError(
          0,
          "network_error",
          "Can't reach file storage. Check your connection and try again.",
        ),
      );
    request.send(file);
  });
}
