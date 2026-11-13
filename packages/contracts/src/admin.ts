import { z } from "zod";
import { pageCursorSchema } from "./paging";
import { identityProviderSchema } from "./auth";
import { workspaceRoleSchema } from "./workspaces";

/** Platform admins only. Every /admin route checks the role on the server. */

export const adminOverviewSchema = z.object({
  users: z.number(),
  activeUsers7d: z.number(),
  newUsers7d: z.number(),
  suspendedUsers: z.number(),
  workspaces: z.number(),
  teamWorkspaces: z.number(),
  documents: z.number(),
  costTodayNanoUsd: z.number(),
  cost30dNanoUsd: z.number(),
  calls30d: z.number(),
});

export const adminUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(["user", "admin"]),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  suspended: z.boolean(),
});
export const adminUserListQuerySchema = z.object({
  /** Matches email or name. */
  query: z.string().trim().max(200).optional(),
  /** `nextCursor` from the previous page. */
  cursor: pageCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const adminUserListResponseSchema = z.object({
  users: z.array(adminUserSchema),
  nextCursor: pageCursorSchema.nullable(),
});
export const adminUserDetailSchema = adminUserSchema.extend({
  hasPassword: z.boolean(),
  phone: z.string().nullable(),
  identities: z.array(identityProviderSchema),
  activeSessions: z.number(),
  cost30dNanoUsd: z.number(),
  workspaces: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      role: workspaceRoleSchema,
      isPersonal: z.boolean(),
      memberCount: z.number(),
    }),
  ),
});
export const adminUserParamsSchema = z.object({ userId: z.uuid() });
export const updateAdminUserRequestSchema = z
  .object({
    role: z.enum(["user", "admin"]).optional(),
    suspended: z.boolean().optional(),
  })
  .refine((value) => value.role !== undefined || value.suspended !== undefined, {
    message: "Change the role or suspension",
  });

/** One model in the registry, as the admin app edits it. */
export const adminModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  provider: z.string(),
  kind: z.enum(["chat", "embedding"]),
  contextWindow: z.number(),
  maxOutputTokens: z.number().optional(),
  dimensions: z.number().optional(),
  pricing: z.object({
    input: z.number(),
    output: z.number(),
    cachedInput: z.number().optional(),
  }),
  capabilities: z.array(z.enum(["tools", "vision", "reasoning"])),
  tier: z.enum(["free", "pro"]),
  selectable: z.boolean(),
  enabled: z.boolean(),
  fallback: z.object({ provider: z.enum(["openai", "anthropic"]), model: z.string() }).optional(),
});
export const adminModelsSchema = z.object({
  defaults: z.object({
    chat: z.string(),
    utility: z.string(),
    moderation: z.string(),
    embedding: z.string(),
    /** Fast model for voice conversations; the chat model when unset. */
    voice: z.string().optional(),
  }),
  models: z.array(adminModelSchema),
});
export const adminModelsResponseSchema = adminModelsSchema.extend({
  /** "saved" after an admin has edited it; "file" while models.json applies. */
  source: z.enum(["saved", "file"]),
  updatedAt: z.iso.datetime().nullable(),
});

export const adminUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export const adminUsageResponseSchema = z.object({
  days: z.array(z.object({ day: z.string(), calls: z.number(), costNanoUsd: z.number() })),
  models: z.array(
    z.object({
      modelId: z.string(),
      calls: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      costNanoUsd: z.number(),
    }),
  ),
  topWorkspaces: z.array(
    z.object({ id: z.uuid(), name: z.string(), calls: z.number(), costNanoUsd: z.number() }),
  ),
  topUsers: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string(),
      calls: z.number(),
      costNanoUsd: z.number(),
    }),
  ),
});

export const adminAuditQuerySchema = z.object({
  actorId: z.uuid().optional(),
  workspaceId: z.uuid().optional(),
  /** A prefix, like "auth." or "member.removed". */
  action: z.string().trim().max(80).optional(),
  before: pageCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;
export type UpdateAdminUserRequest = z.infer<typeof updateAdminUserRequestSchema>;
export type AdminModel = z.infer<typeof adminModelSchema>;
export type AdminModels = z.infer<typeof adminModelsSchema>;
export type AdminModelsResponse = z.infer<typeof adminModelsResponseSchema>;
export type AdminUsageResponse = z.infer<typeof adminUsageResponseSchema>;
export type AdminAuditQuery = z.input<typeof adminAuditQuerySchema>;
