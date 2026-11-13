import {
  billingSummarySchema,
  checkoutResponseSchema,
  portalResponseSchema,
  type BillingSummary,
  type CheckoutRequest,
  type UpdateExtraUsageRequest,
  adminModelsResponseSchema,
  adminOverviewSchema,
  adminUsageResponseSchema,
  adminVoiceResponseSchema,
  type AdminVoiceResponse,
  adminUserDetailSchema,
  adminUserListResponseSchema,
  type AdminAuditQuery,
  type AdminModels,
  type AdminModelsResponse,
  type AdminOverview,
  type AdminUsageResponse,
  type AdminUserDetail,
  type AdminUserListResponse,
  type UpdateAdminUserRequest,
  acceptInvitationResponseSchema,
  auditLogResponseSchema,
  invitationListResponseSchema,
  invitationPreviewSchema,
  invitationSchema,
  memberListResponseSchema,
  memberSchema,
  type AssignableRole,
  type AuditLogResponse,
  type CreateInvitationRequest,
  type Invitation,
  type InvitationPreview,
  type Member,
  connectedAppListResponseSchema,
  oauthAuthorizationSchema,
  oauthRedirectResponseSchema,
  type ConnectedApp,
  type OAuthAuthorization,
  identityListResponseSchema,
  oauthLinkResponseSchema,
  phoneCodeSentResponseSchema,
  signInOptionsSchema,
  type Identity,
  type IdentityProvider,
  type PhoneCodeSentResponse,
  type PhoneVerifyRequest,
  type SignInOptions,
  authResponseSchema,
  loginResponseSchema,
  recoveryCodesResponseSchema,
  sessionListResponseSchema,
  twoFactorSetupResponseSchema,
  type DisableTwoFactorRequest,
  type LoginResponse,
  type ResetPasswordRequest,
  type Session,
  type TwoFactorLoginRequest,
  type TwoFactorSetupResponse,
  completionResponseSchema,
  modelListResponseSchema,
  usageSummarySchema,
  attachmentSchema,
  createDocumentResponseSchema,
  uploadedPartsResponseSchema,
  uploadPartsResponseSchema,
  documentListResponseSchema,
  documentSchema,
  graphOverviewSchema,
  downloadResponseSchema,
  searchResponseSchema,
  skillListResponseSchema,
  memoryResponseSchema,
  voiceChallengeSchema,
  voiceListSchema,
  voiceOptionSchema,
  voiceSessionSchema,
  voiceStatusSchema,
  type VoiceChallenge,
  type VoiceList,
  type VoiceOption,
  type CreateVoiceSessionRequest,
  type VoiceSession,
  type VoiceStatus,
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
  type GraphOverview,
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
  type UpdateProfileRequest,
  type Workspace,
  type GenerateImageRequest,
  type UpdateWorkspacePolicies,
  type WorkspacePolicies,
  workspacePoliciesSchema,
  type GenerateVideoRequest,
  type MediaItem,
  type MediaListResponse,
  type MediaStatus,
  mediaItemSchema,
  mediaListResponseSchema,
  mediaStatusResponseSchema,
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
      /** Creates the account and signs in; a link to confirm the email follows by email. */
      signup: async (input: SignupRequest): Promise<AuthResponse> =>
        parse(authResponseSchema, (await http.post("/auth/signup", input)).data),
      /** A session, or a request for the second sign-in step. */
      login: async (input: LoginRequest): Promise<LoginResponse> =>
        parse(loginResponseSchema, (await http.post("/auth/login", input)).data),
      options: async (): Promise<SignInOptions> =>
        parse(signInOptionsSchema, (await http.get("/auth/options")).data),
      /** Where the browser goes to sign in with Google or GitHub (a full-page navigation). */
      oauthStartUrl: (provider: IdentityProvider, next?: string): string => {
        const url = new URL(`/auth/oauth/${provider}/start`, client.baseURL);
        if (next) url.searchParams.set("next", next);
        return url.toString();
      },
      exchangeTicket: async (ticket: string): Promise<LoginResponse> =>
        parse(loginResponseSchema, (await http.post("/auth/oauth/exchange", { ticket })).data),
      startPhoneSignIn: async (phone: string): Promise<PhoneCodeSentResponse> =>
        parse(phoneCodeSentResponseSchema, (await http.post("/auth/phone/start", { phone })).data),
      verifyPhoneSignIn: async (input: PhoneVerifyRequest): Promise<LoginResponse> =>
        parse(loginResponseSchema, (await http.post("/auth/phone/verify", input)).data),
      completeTwoFactor: async (input: TwoFactorLoginRequest): Promise<AuthResponse> =>
        parse(authResponseSchema, (await http.post("/auth/login/two-factor", input)).data),
      forgotPassword: async (email: string): Promise<void> => {
        await http.post("/auth/password/forgot", { email });
      },
      resetPassword: async (input: ResetPasswordRequest): Promise<void> => {
        await http.post("/auth/password/reset", input);
      },
      sessions: async (): Promise<Session[]> =>
        parse(sessionListResponseSchema, (await http.get("/auth/sessions")).data).sessions,
      revokeSession: async (sessionId: string): Promise<void> => {
        await http.delete(`/auth/sessions/${sessionId}`);
      },
      logout: async (): Promise<void> => {
        await http.post("/auth/logout");
      },
      refresh: refreshSession,
    },
    users: {
      me: async (): Promise<PublicUser> =>
        parse(publicUserSchema, (await http.get("/users/me")).data),
      updateProfile: async (input: UpdateProfileRequest): Promise<PublicUser> =>
        parse(publicUserSchema, (await http.patch("/users/me", input)).data),
      /** Confirms the signed-in user's email with the token from the emailed link. */
      verifyEmail: async (token: string): Promise<PublicUser> =>
        parse(publicUserSchema, (await http.post("/users/me/email/verify", { token })).data),
      /** Emails a new confirmation link. */
      resendEmailVerification: async (): Promise<void> => {
        await http.post("/users/me/email/verification");
      },
      changePassword: async (input: ChangePasswordRequest): Promise<AuthResponse> =>
        parse(authResponseSchema, (await http.post("/users/me/password", input)).data),
      identities: async (): Promise<Identity[]> =>
        parse(identityListResponseSchema, (await http.get("/users/me/identities")).data).identities,
      /** The provider URL to send the browser to; the callback links the account. */
      linkIdentity: async (provider: IdentityProvider): Promise<string> =>
        parse(oauthLinkResponseSchema, (await http.post(`/auth/oauth/${provider}/link`)).data).url,
      unlinkIdentity: async (provider: IdentityProvider): Promise<void> => {
        await http.delete(`/users/me/identities/${provider}`);
      },
      addPhone: async (phone: string): Promise<PhoneCodeSentResponse> =>
        parse(phoneCodeSentResponseSchema, (await http.post("/users/me/phone", { phone })).data),
      confirmPhone: async (input: PhoneVerifyRequest): Promise<PublicUser> =>
        parse(publicUserSchema, (await http.post("/users/me/phone/verify", input)).data),
      removePhone: async (): Promise<PublicUser> =>
        parse(publicUserSchema, (await http.delete("/users/me/phone")).data),
      twoFactor: {
        setup: async (): Promise<TwoFactorSetupResponse> =>
          parse(twoFactorSetupResponseSchema, (await http.post("/users/me/two-factor/setup")).data),
        /** Returns the recovery codes, shown once. */
        enable: async (code: string): Promise<string[]> =>
          parse(
            recoveryCodesResponseSchema,
            (await http.post("/users/me/two-factor/enable", { code })).data,
          ).recoveryCodes,
        disable: async (input: DisableTwoFactorRequest): Promise<void> => {
          await http.post("/users/me/two-factor/disable", input);
        },
        regenerateRecoveryCodes: async (code: string): Promise<string[]> =>
          parse(
            recoveryCodesResponseSchema,
            (await http.post("/users/me/two-factor/recovery-codes", { code })).data,
          ).recoveryCodes,
      },
    },
    /** A team workspace's people: members, roles, invitations, and its audit log. */
    members: {
      list: async (workspaceId: string): Promise<Member[]> =>
        parse(memberListResponseSchema, (await http.get(`/workspaces/${workspaceId}/members`)).data)
          .members,
      updateRole: async (
        workspaceId: string,
        userId: string,
        role: AssignableRole,
      ): Promise<Member> =>
        parse(
          memberSchema,
          (await http.patch(`/workspaces/${workspaceId}/members/${userId}`, { role })).data,
        ),
      /** Removes a member, or leaves when it's the current user. */
      remove: async (workspaceId: string, userId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/members/${userId}`);
      },
      transferOwnership: async (workspaceId: string, userId: string): Promise<void> => {
        await http.post(`/workspaces/${workspaceId}/transfer`, { userId });
      },
      invitations: async (workspaceId: string): Promise<Invitation[]> =>
        parse(
          invitationListResponseSchema,
          (await http.get(`/workspaces/${workspaceId}/invitations`)).data,
        ).invitations,
      invite: async (workspaceId: string, input: CreateInvitationRequest): Promise<Invitation> =>
        parse(
          invitationSchema,
          (await http.post(`/workspaces/${workspaceId}/invitations`, input)).data,
        ),
      revokeInvitation: async (workspaceId: string, invitationId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/invitations/${invitationId}`);
      },
      auditLog: async (workspaceId: string, before?: string): Promise<AuditLogResponse> =>
        parse(
          auditLogResponseSchema,
          (
            await http.get(`/workspaces/${workspaceId}/audit-log`, {
              params: before ? { before } : {},
            })
          ).data,
        ),
    },
    /** A workspace's plan, usage limits, extra usage, and payments. */
    billing: {
      summary: async (workspaceId: string): Promise<BillingSummary> =>
        parse(billingSummarySchema, (await http.get(`/workspaces/${workspaceId}/billing`)).data),
      updateExtraUsage: async (
        workspaceId: string,
        input: UpdateExtraUsageRequest,
      ): Promise<BillingSummary> =>
        parse(
          billingSummarySchema,
          (await http.put(`/workspaces/${workspaceId}/billing/extra-usage`, input)).data,
        ),
      /** A payment page to go to, or null when the existing subscription was switched. */
      checkout: async (workspaceId: string, input: CheckoutRequest): Promise<string | null> =>
        parse(
          checkoutResponseSchema,
          (await http.post(`/workspaces/${workspaceId}/billing/checkout`, input)).data,
        ).url,
      portal: async (workspaceId: string): Promise<string> =>
        parse(
          portalResponseSchema,
          (await http.post(`/workspaces/${workspaceId}/billing/portal`)).data,
        ).url,
      setCancel: async (workspaceId: string, cancel: boolean): Promise<BillingSummary> =>
        parse(
          billingSummarySchema,
          (await http.post(`/workspaces/${workspaceId}/billing/cancel`, { cancel })).data,
        ),
    },
    /** Platform admins only; the API checks the role on every call. */
    admin: {
      overview: async (): Promise<AdminOverview> =>
        parse(adminOverviewSchema, (await http.get("/admin/overview")).data),
      users: async (
        query: { query?: string; cursor?: string; limit?: number } = {},
      ): Promise<AdminUserListResponse> =>
        parse(
          adminUserListResponseSchema,
          (await http.get("/admin/users", { params: query })).data,
        ),
      user: async (userId: string): Promise<AdminUserDetail> =>
        parse(adminUserDetailSchema, (await http.get(`/admin/users/${userId}`)).data),
      updateUser: async (
        userId: string,
        change: UpdateAdminUserRequest,
      ): Promise<AdminUserDetail> =>
        parse(adminUserDetailSchema, (await http.patch(`/admin/users/${userId}`, change)).data),
      signOutUser: async (userId: string): Promise<void> => {
        await http.post(`/admin/users/${userId}/sign-out`);
      },
      models: async (): Promise<AdminModelsResponse> =>
        parse(adminModelsResponseSchema, (await http.get("/admin/models")).data),
      saveModels: async (models: AdminModels): Promise<AdminModelsResponse> =>
        parse(adminModelsResponseSchema, (await http.put("/admin/models", models)).data),
      voice: async (days: number): Promise<AdminVoiceResponse> =>
        parse(
          adminVoiceResponseSchema,
          (await http.get("/admin/voice", { params: { days } })).data,
        ),
      usage: async (days: number): Promise<AdminUsageResponse> =>
        parse(
          adminUsageResponseSchema,
          (await http.get("/admin/usage", { params: { days } })).data,
        ),
      auditLog: async (query: AdminAuditQuery = {}): Promise<AuditLogResponse> =>
        parse(auditLogResponseSchema, (await http.get("/admin/audit-log", { params: query })).data),
    },
    invitations: {
      preview: async (token: string): Promise<InvitationPreview> =>
        parse(invitationPreviewSchema, (await http.get(`/invitations/${token}`)).data),
      accept: async (token: string): Promise<Workspace> =>
        parse(
          acceptInvitationResponseSchema,
          (await http.post(`/invitations/${token}/accept`)).data,
        ).workspace,
    },
    /** Signing outside MCP clients in: the consent page and connected apps. */
    oauth: {
      describe: async (authorizationId: string): Promise<OAuthAuthorization> =>
        parse(
          oauthAuthorizationSchema,
          (await http.get(`/oauth/authorizations/${authorizationId}`)).data,
        ),
      /** Returns where to send the browser: back to the client with a code. */
      approve: async (authorizationId: string, workspaceId: string): Promise<string> =>
        parse(
          oauthRedirectResponseSchema,
          (await http.post(`/oauth/authorizations/${authorizationId}/approve`, { workspaceId }))
            .data,
        ).redirectUrl,
      deny: async (authorizationId: string): Promise<string> =>
        parse(
          oauthRedirectResponseSchema,
          (await http.post(`/oauth/authorizations/${authorizationId}/deny`)).data,
        ).redirectUrl,
      apps: async (): Promise<ConnectedApp[]> =>
        parse(connectedAppListResponseSchema, (await http.get("/users/me/connected-apps")).data)
          .apps,
      disconnect: async (appId: string): Promise<void> => {
        await http.delete(`/users/me/connected-apps/${appId}`);
      },
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
      /** Deletes a team workspace and everything in it. Owners only; `name` must match. */
      remove: async (workspaceId: string, name: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}`, { data: { name } });
      },
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
      /** A page of chats, newest first: older ones with `before`, matching ones with `q`. */
      threads: async (
        workspaceId: string,
        { before, q }: { before?: string; q?: string } = {},
      ): Promise<ThreadListResponse> =>
        parse(
          threadListResponseSchema,
          (await http.get(`/workspaces/${workspaceId}/threads`, { params: { before, q } })).data,
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
      /** Switches a user message to one of its earlier versions; returns the chat as it is now. */
      restoreVersion: async (
        workspaceId: string,
        threadId: string,
        messageId: string,
        position: number,
      ): Promise<ThreadResponse> =>
        parse(
          threadResponseSchema,
          (
            await http.post(
              `/workspaces/${workspaceId}/threads/${threadId}/messages/${messageId}/versions/${position}/restore`,
            )
          ).data,
        ),
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
      /** Adds a reference file or template to a skill, or replaces the one at that path. */
      putFile: async (
        workspaceId: string,
        skillId: string,
        file: { path: string; content: string },
      ): Promise<void> => {
        await http.put(`/workspaces/${workspaceId}/skills/${skillId}/files`, file);
      },
      removeFile: async (workspaceId: string, skillId: string, path: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/skills/${skillId}/files`, {
          params: { path },
        });
      },
    },
    graph: {
      /** The knowledge graph's size and, with an entity, its connections. */
      explore: async (workspaceId: string, entity?: string): Promise<GraphOverview> =>
        parse(
          graphOverviewSchema,
          (
            await http.get(`/workspaces/${workspaceId}/graph`, {
              params: entity ? { entity, depth: 2 } : {},
            })
          ).data,
        ),
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
       * Big files go up in parts, each retried on its own; passing `resume`
       * (a document whose parts were already arriving) carries on from the
       * parts that made it.
       */
      upload: async (
        workspaceId: string,
        file: File,
        onProgress?: (fraction: number) => void,
        options: { resume?: string; onStart?: (documentId: string) => void } = {},
      ): Promise<DocumentSummary> => {
        const base = `/workspaces/${workspaceId}/documents`;
        let documentId: string | undefined;
        let plan: { partSize: number; partCount: number; uploaded: Set<number> } | undefined;
        if (options.resume) {
          try {
            const parts = parse(
              uploadedPartsResponseSchema,
              (await http.get(`${base}/${options.resume}/parts`)).data,
            );
            documentId = options.resume;
            plan = { ...parts, uploaded: new Set(parts.uploaded.map((part) => part.partNumber)) };
          } catch {
            // Gone or finished: start again.
          }
        }
        if (!documentId) {
          const created = parse(
            createDocumentResponseSchema,
            (await http.post(base, { filename: file.name, sizeBytes: file.size })).data,
          );
          documentId = created.document.id;
          if (created.multipart) plan = { ...created.multipart, uploaded: new Set() };
          else if (created.upload) await putToStorage(created.upload, file, onProgress);
        }
        if (plan) {
          options.onStart?.(documentId);
          await uploadParts(http, `${base}/${documentId}/parts`, file, plan, onProgress);
        }
        return parse(documentSchema, (await http.post(`${base}/${documentId}/complete`)).data);
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
    policies: {
      /** The workspace's tool, connector, and skill policies. */
      get: async (workspaceId: string): Promise<WorkspacePolicies> =>
        parse(
          workspacePoliciesSchema,
          (await http.get(`/workspaces/${workspaceId}/policies`)).data,
        ),
      update: async (
        workspaceId: string,
        input: UpdateWorkspacePolicies,
      ): Promise<WorkspacePolicies> =>
        parse(
          workspacePoliciesSchema,
          (await http.put(`/workspaces/${workspaceId}/policies`, input)).data,
        ),
    },
    media: {
      /** Whether this server makes images and videos. */
      status: async (workspaceId: string): Promise<MediaStatus> =>
        parse(
          mediaStatusResponseSchema,
          (await http.get(`/workspaces/${workspaceId}/media/status`)).data,
        ),
      /** The user's gallery, newest first. */
      list: async (
        workspaceId: string,
        query: { kind?: "image" | "video"; before?: string; limit?: number } = {},
      ): Promise<MediaListResponse> =>
        parse(
          mediaListResponseSchema,
          (await http.get(`/workspaces/${workspaceId}/media`, { params: query })).data,
        ),
      get: async (workspaceId: string, mediaId: string): Promise<MediaItem> =>
        parse(
          mediaItemSchema,
          (await http.get(`/workspaces/${workspaceId}/media/${mediaId}`)).data,
        ),
      /** Makes an image from a prompt, or edits the source images. */
      generateImage: async (workspaceId: string, input: GenerateImageRequest): Promise<MediaItem> =>
        parse(
          mediaItemSchema,
          (
            await http.post(`/workspaces/${workspaceId}/media/images`, input, {
              timeout: 240_000,
            })
          ).data,
        ),
      /** Starts a video; it's made in the background and the item says how far along it is. */
      startVideo: async (workspaceId: string, input: GenerateVideoRequest): Promise<MediaItem> =>
        parse(
          mediaItemSchema,
          (await http.post(`/workspaces/${workspaceId}/media/videos`, input)).data,
        ),
      /** The file (or its small preview) as a Blob: img tags can't send the auth header. */
      blob: async (
        workspaceId: string,
        mediaId: string,
        variant: "original" | "preview" = "original",
      ): Promise<Blob> =>
        (
          await http.get<Blob>(`/workspaces/${workspaceId}/media/${mediaId}/content`, {
            params: { variant },
            responseType: "blob",
          })
        ).data,
      remove: async (workspaceId: string, mediaId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/media/${mediaId}`);
      },
    },
    voice: {
      /** Whether this server offers voice conversations. */
      status: async (workspaceId: string): Promise<VoiceStatus> =>
        parse(voiceStatusSchema, (await http.get(`/workspaces/${workspaceId}/voice/status`)).data),
      /** Starts a conversation: a new chat, or `threadId` continued by voice. */
      start: async (
        workspaceId: string,
        input: CreateVoiceSessionRequest = {},
      ): Promise<VoiceSession> =>
        parse(
          voiceSessionSchema,
          (await http.post(`/workspaces/${workspaceId}/voice/sessions`, input)).data,
        ),
      end: async (workspaceId: string, sessionId: string): Promise<void> => {
        await http.post(`/workspaces/${workspaceId}/voice/sessions/${sessionId}/end`);
      },
      /** The voices Tessel can speak with, and which one is chosen. */
      voices: async (workspaceId: string): Promise<VoiceList> =>
        parse(voiceListSchema, (await http.get(`/workspaces/${workspaceId}/voice/voices`)).data),
      selectVoice: async (workspaceId: string, voiceId: string): Promise<void> => {
        await http.put(`/workspaces/${workspaceId}/voice/voices/selected`, { voiceId });
      },
      /** A passage and one-time code to read aloud before adding a voice. */
      voiceChallenge: async (workspaceId: string): Promise<VoiceChallenge> =>
        parse(
          voiceChallengeSchema,
          (await http.post(`/workspaces/${workspaceId}/voice/voices/challenge`)).data,
        ),
      /** Adds the user's own voice from their recording of the passage and code. */
      addVoice: async (
        workspaceId: string,
        input: { token: string; name: string; recording: Blob },
      ): Promise<VoiceOption> =>
        parse(
          voiceOptionSchema,
          (
            await http.post(`/workspaces/${workspaceId}/voice/voices`, input.recording, {
              params: { name: input.name },
              headers: {
                "Content-Type": input.recording.type.split(";")[0] || "audio/webm",
                "X-Voice-Challenge": input.token,
              },
              timeout: 120_000,
            })
          ).data,
        ),
      removeVoice: async (workspaceId: string, ownVoiceId: string): Promise<void> => {
        await http.delete(`/workspaces/${workspaceId}/voice/voices/${ownVoiceId}`);
      },
      /** A reply read aloud in the user's chosen voice, as an MP3. */
      speak: async (workspaceId: string, messageId: string): Promise<Blob> =>
        (
          await http.post(
            `/workspaces/${workspaceId}/voice/speak`,
            { messageId },
            { responseType: "blob", timeout: 60_000 },
          )
        ).data as Blob,
      /** A short recording as text, for the composer. */
      transcribe: async (workspaceId: string, recording: Blob): Promise<string> =>
        (
          (
            await http.post(`/workspaces/${workspaceId}/voice/transcribe`, recording, {
              headers: { "Content-Type": recording.type.split(";")[0] || "audio/webm" },
              timeout: 60_000,
            })
          ).data as { text: string }
        ).text,
      /** A few seconds of a voice, as an MP3. */
      voicePreview: async (workspaceId: string, voiceId: string): Promise<Blob> =>
        (
          await http.get(
            `/workspaces/${workspaceId}/voice/voices/${encodeURIComponent(voiceId)}/preview`,
            { responseType: "blob" },
          )
        ).data as Blob,
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
/** Parts going up at once. */
const PART_CONCURRENCY = 4;
const PART_ATTEMPTS = 3;

async function uploadParts(
  http: ApiClient["http"],
  partsUrl: string,
  file: Blob,
  plan: { partSize: number; partCount: number; uploaded: Set<number> },
  onProgress?: (fraction: number) => void,
) {
  const sizeOf = (number: number) =>
    Math.min(plan.partSize, file.size - (number - 1) * plan.partSize);
  const missing = Array.from({ length: plan.partCount }, (_, i) => i + 1).filter(
    (number) => !plan.uploaded.has(number),
  );
  let done = [...plan.uploaded].reduce((total, number) => total + sizeOf(number), 0);
  const inFlight = new Map<number, number>();
  const report = () =>
    onProgress?.((done + [...inFlight.values()].reduce((a, b) => a + b, 0)) / file.size);
  report();

  // URLs in batches, as they're needed (they expire after an hour).
  const urls = new Map<number, string>();
  async function urlFor(number: number) {
    if (!urls.has(number)) {
      const batch = missing.filter((n) => n >= number && !urls.has(n)).slice(0, 20);
      const { parts } = uploadPartsResponseSchema.parse(
        (await http.post(partsUrl, { partNumbers: batch })).data,
      );
      for (const part of parts) urls.set(part.partNumber, part.url);
    }
    return urls.get(number)!;
  }

  const queue = [...missing];
  async function worker() {
    for (let number = queue.shift(); number !== undefined; number = queue.shift()) {
      const start = (number - 1) * plan.partSize;
      const blob = file.slice(start, start + sizeOf(number));
      for (let attempt = 1; ; attempt++) {
        try {
          const partNumber = number;
          await putToStorage(
            { url: await urlFor(number), method: "PUT", headers: {}, expiresAt: "" },
            blob,
            (fraction) => {
              inFlight.set(partNumber, fraction * blob.size);
              report();
            },
          );
          break;
        } catch (error) {
          inFlight.delete(number);
          urls.delete(number);
          if (attempt >= PART_ATTEMPTS) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        }
      }
      inFlight.delete(number);
      done += blob.size;
      report();
    }
  }
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, missing.length) }, worker));
}

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
