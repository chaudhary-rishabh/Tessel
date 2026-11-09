import { z } from "zod";
import { pageCursorSchema } from "./paging";
import { emailSchema } from "./users";
import { workspaceRoleSchema, workspaceSchema } from "./workspaces";

/** The roles an invitation or a role change can give. Ownership moves only by transfer. */
export const assignableRoleSchema = z.enum(["admin", "member"]);

export const memberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: workspaceRoleSchema,
  joinedAt: z.iso.datetime(),
});
export const memberListResponseSchema = z.object({ members: z.array(memberSchema) });
export const memberParamsSchema = z.object({ workspaceId: z.uuid(), userId: z.uuid() });
export const updateMemberRequestSchema = z.object({ role: assignableRoleSchema });
export const transferOwnershipRequestSchema = z.object({ userId: z.uuid() });

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: assignableRoleSchema,
  invitedBy: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export const invitationListResponseSchema = z.object({ invitations: z.array(invitationSchema) });
export const createInvitationRequestSchema = z.object({
  email: emailSchema,
  role: assignableRoleSchema.default("member"),
});
export const invitationParamsSchema = z.object({ workspaceId: z.uuid(), invitationId: z.uuid() });

/** What an invitation link shows, before signing in. */
export const invitationPreviewSchema = z.object({
  workspaceName: z.string(),
  inviterName: z.string().nullable(),
  email: z.string(),
  role: assignableRoleSchema,
  expiresAt: z.iso.datetime(),
});
export const invitationTokenParamsSchema = z.object({ token: z.string().min(20).max(200) });
export const acceptInvitationResponseSchema = z.object({ workspace: workspaceSchema });

/** One entry in an audit log. */
export const auditEventSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  actor: z.object({ id: z.uuid(), name: z.string(), email: z.string() }).nullable(),
  workspaceId: z.uuid().nullable(),
  target: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ipAddress: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const auditLogQuerySchema = z.object({
  /** Events older than this, for the next page. */
  before: pageCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const auditLogResponseSchema = z.object({
  events: z.array(auditEventSchema),
  /** Pass as `before` to get older events; null when there are none. */
  nextBefore: z.iso.datetime().nullable(),
});

export type AssignableRole = z.infer<typeof assignableRoleSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type CreateInvitationRequest = z.input<typeof createInvitationRequestSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;
