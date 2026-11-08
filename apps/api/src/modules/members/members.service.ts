import { randomBytes } from "node:crypto";
import type {
  AssignableRole,
  AuditEvent,
  AuditLogResponse,
  Invitation,
  InvitationPreview,
  Member,
  Workspace,
} from "@tessel/contracts";
import {
  auditEvents,
  users,
  withUserContext,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
  type Database,
  type Transaction,
} from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { aliasedTable, and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { AuditRecorder } from "../../lib/audit";
import { errors } from "../../lib/errors";
import { emails, type Mailer } from "../../lib/mailer";
import { hashToken } from "../auth/tokens";
import { toWorkspace, workspacesRepository } from "../workspaces/workspaces.repository";

const INVITATION_TTL_MS = 7 * 86_400_000;
const MAX_PENDING_INVITATIONS = 50;

/** Who is acting, and from where, for permission checks and the audit log. */
export interface MemberActor {
  userId: string;
  ipAddress?: string | undefined;
}

export interface MembersServiceDependencies {
  db: Database;
  logger: Logger;
  mailer: Mailer;
  audit: AuditRecorder;
  /** For invitation links: WEB/invite/:token. */
  webOrigin: string;
  now?: () => Date;
}

/**
 * Team workspaces: members and their roles, invitations by email, leaving,
 * and handing ownership over. Owners manage roles; owners and admins invite
 * and remove members. Row-level security enforces the same rules underneath.
 */
export function createMembersService({
  db,
  logger,
  mailer,
  audit,
  webOrigin,
  now = () => new Date(),
}: MembersServiceDependencies) {
  /** The actor's view of a workspace, or not found when they don't belong to it. */
  async function membership(tx: Transaction, workspaceId: string, userId: string) {
    const workspace = await workspacesRepository.findForUser(tx, workspaceId, userId);
    if (!workspace) throw errors.notFound("Workspace not found");
    return workspace;
  }

  function requireManager(role: string) {
    if (role !== "owner" && role !== "admin") {
      throw errors.forbidden("Only owners and admins can manage members");
    }
  }

  async function memberRow(tx: Transaction, workspaceId: string, userId: string) {
    const [row] = await tx
      .select({ role: workspaceMembers.role, email: users.email, name: users.name })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
    return row;
  }

  return {
    async list(userId: string, workspaceId: string): Promise<Member[]> {
      return withUserContext(db, userId, async (tx) => {
        await membership(tx, workspaceId, userId);
        const rows = await tx
          .select({
            userId: workspaceMembers.userId,
            role: workspaceMembers.role,
            joinedAt: workspaceMembers.createdAt,
            name: users.name,
            email: users.email,
          })
          .from(workspaceMembers)
          .innerJoin(users, eq(users.id, workspaceMembers.userId))
          .where(eq(workspaceMembers.workspaceId, workspaceId))
          .orderBy(
            sql`case ${workspaceMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
            asc(users.name),
          );
        return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }));
      });
    },

    /** Emails an invitation; inviting the same address again replaces the earlier link. */
    async invite(
      actor: MemberActor,
      workspaceId: string,
      input: { email: string; role: AssignableRole },
    ): Promise<Invitation> {
      const token = randomBytes(32).toString("base64url");
      const { invitation, workspaceName, inviterName } = await withUserContext(
        db,
        actor.userId,
        async (tx) => {
          const workspace = await membership(tx, workspaceId, actor.userId);
          requireManager(workspace.role);
          if (workspace.isPersonal) {
            throw errors.conflict(
              "personal_workspace",
              "Personal workspaces are just for you. Create a team workspace to invite people.",
            );
          }
          if (input.role === "admin" && workspace.role !== "owner") {
            throw errors.forbidden("Only the owner can invite admins");
          }
          const [existing] = await tx
            .select({ userId: workspaceMembers.userId })
            .from(workspaceMembers)
            .innerJoin(users, eq(users.id, workspaceMembers.userId))
            .where(
              and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, input.email)),
            );
          if (existing) {
            throw errors.conflict("already_member", "That person is already in this workspace");
          }
          const pending = await tx
            .select({ id: workspaceInvitations.id })
            .from(workspaceInvitations)
            .where(
              and(
                eq(workspaceInvitations.workspaceId, workspaceId),
                isNull(workspaceInvitations.acceptedAt),
                isNull(workspaceInvitations.revokedAt),
                gt(workspaceInvitations.expiresAt, now()),
              ),
            );
          if (pending.length >= MAX_PENDING_INVITATIONS) {
            throw errors.conflict(
              "too_many_invitations",
              "Revoke some pending invitations before sending more",
            );
          }
          await tx
            .update(workspaceInvitations)
            .set({ revokedAt: now() })
            .where(
              and(
                eq(workspaceInvitations.workspaceId, workspaceId),
                eq(workspaceInvitations.email, input.email),
                isNull(workspaceInvitations.acceptedAt),
                isNull(workspaceInvitations.revokedAt),
              ),
            );
          const [row] = await tx
            .insert(workspaceInvitations)
            .values({
              workspaceId,
              email: input.email,
              role: input.role,
              tokenHash: hashToken(token),
              invitedBy: actor.userId,
              expiresAt: new Date(now().getTime() + INVITATION_TTL_MS),
            })
            .returning();
          const [inviter] = await tx
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, actor.userId));
          return {
            invitation: row!,
            workspaceName: workspace.name,
            inviterName: inviter?.name ?? "Someone",
          };
        },
      );
      await mailer.send(
        emails.invitation(input.email, {
          inviter: inviterName,
          workspace: workspaceName,
          role: input.role,
          link: `${webOrigin}/invite/${token}`,
        }),
      );
      await audit.record({
        actorId: actor.userId,
        workspaceId,
        action: "member.invited",
        target: `invitation:${invitation.id}`,
        metadata: { email: input.email, role: input.role },
        ipAddress: actor.ipAddress,
      });
      return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role as AssignableRole,
        invitedBy: inviterName,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
      };
    },

    async listInvitations(userId: string, workspaceId: string): Promise<Invitation[]> {
      return withUserContext(db, userId, async (tx) => {
        requireManager((await membership(tx, workspaceId, userId)).role);
        const rows = await tx
          .select({ invitation: workspaceInvitations, inviter: users.name })
          .from(workspaceInvitations)
          .leftJoin(users, eq(users.id, workspaceInvitations.invitedBy))
          .where(
            and(
              eq(workspaceInvitations.workspaceId, workspaceId),
              isNull(workspaceInvitations.acceptedAt),
              isNull(workspaceInvitations.revokedAt),
              gt(workspaceInvitations.expiresAt, now()),
            ),
          )
          .orderBy(desc(workspaceInvitations.createdAt));
        return rows.map(({ invitation, inviter }) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role as AssignableRole,
          invitedBy: inviter,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
        }));
      });
    },

    async revokeInvitation(actor: MemberActor, workspaceId: string, invitationId: string) {
      const revoked = await withUserContext(db, actor.userId, async (tx) => {
        requireManager((await membership(tx, workspaceId, actor.userId)).role);
        return tx
          .update(workspaceInvitations)
          .set({ revokedAt: now() })
          .where(
            and(
              eq(workspaceInvitations.id, invitationId),
              eq(workspaceInvitations.workspaceId, workspaceId),
              isNull(workspaceInvitations.acceptedAt),
              isNull(workspaceInvitations.revokedAt),
            ),
          )
          .returning({ email: workspaceInvitations.email });
      });
      if (revoked.length === 0) throw errors.notFound("Invitation not found");
      await audit.record({
        actorId: actor.userId,
        workspaceId,
        action: "member.invitation_revoked",
        target: `invitation:${invitationId}`,
        metadata: { email: revoked[0]!.email },
        ipAddress: actor.ipAddress,
      });
    },

    /** What an invitation link shows. Anyone with the link may see it. */
    async preview(token: string): Promise<InvitationPreview> {
      const result = await db.execute<{
        workspace_name: string;
        inviter_name: string | null;
        invited_email: string;
        invited_role: AssignableRole;
        expires_at: string | Date;
      }>(sql`SELECT * FROM app.invitation_preview(${hashToken(token)})`);
      const row = result.rows[0];
      if (!row) {
        throw errors.notFound(
          "This invitation has expired or was already used. Ask for a new one.",
        );
      }
      return {
        workspaceName: row.workspace_name,
        inviterName: row.inviter_name,
        email: row.invited_email,
        role: row.invited_role,
        expiresAt: new Date(row.expires_at).toISOString(),
      };
    },

    /** Joins the workspace, if the invitation is open and was sent to this user's verified email. */
    async accept(actor: MemberActor, token: string): Promise<Workspace> {
      const workspace = await withUserContext(db, actor.userId, async (tx) => {
        const result = await tx.execute<{ joined_workspace_id: string }>(
          sql`SELECT * FROM app.accept_invitation(${hashToken(token)})`,
        );
        const joined = result.rows[0]?.joined_workspace_id;
        if (!joined) return undefined;
        return membership(tx, joined, actor.userId);
      });
      if (!workspace) {
        throw errors.badRequest(
          "invalid_invitation",
          "This invitation has expired, was already used, or was sent to a different email address.",
        );
      }
      logger.info({ userId: actor.userId, workspaceId: workspace.id }, "Joined a workspace");
      await audit.record({
        actorId: actor.userId,
        workspaceId: workspace.id,
        action: "member.joined",
        target: `user:${actor.userId}`,
        metadata: { role: workspace.role },
        ipAddress: actor.ipAddress,
      });
      return toWorkspace(workspace);
    },

    /** Owners change roles between admin and member. */
    async updateRole(
      actor: MemberActor,
      workspaceId: string,
      targetUserId: string,
      role: AssignableRole,
    ): Promise<Member> {
      const member = await withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, workspaceId, actor.userId);
        if (workspace.role !== "owner") throw errors.forbidden("Only the owner can change roles");
        const target = await memberRow(tx, workspaceId, targetUserId);
        if (!target) throw errors.notFound("Member not found");
        if (target.role === "owner") {
          throw errors.conflict(
            "owner_role",
            "Hand ownership to someone else to change the owner's role",
          );
        }
        const [updated] = await tx
          .update(workspaceMembers)
          .set({ role })
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, targetUserId),
            ),
          )
          .returning();
        return { previous: target.role, ...target, joinedAt: updated!.createdAt };
      });
      await audit.record({
        actorId: actor.userId,
        workspaceId,
        action: "member.role_changed",
        target: `user:${targetUserId}`,
        metadata: { from: member.previous, to: role },
        ipAddress: actor.ipAddress,
      });
      return {
        userId: targetUserId,
        name: member.name,
        email: member.email,
        role,
        joinedAt: member.joinedAt.toISOString(),
      };
    },

    /**
     * Removes someone, or lets a member leave. Admins remove members; the
     * owner removes anyone; the owner can't leave without handing over first.
     */
    async remove(actor: MemberActor, workspaceId: string, targetUserId: string): Promise<void> {
      const leaving = targetUserId === actor.userId;
      await withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, workspaceId, actor.userId);
        const target = await memberRow(tx, workspaceId, targetUserId);
        if (!target) throw errors.notFound("Member not found");
        if (target.role === "owner") {
          throw errors.conflict(
            "owner_cannot_leave",
            leaving
              ? "Hand ownership to another member before leaving"
              : "The owner can't be removed",
          );
        }
        if (workspace.isPersonal)
          throw errors.conflict("personal_workspace", "You can't leave your personal workspace");
        if (!leaving) {
          requireManager(workspace.role);
          if (workspace.role === "admin" && target.role !== "member") {
            throw errors.forbidden("Only the owner can remove admins");
          }
        }
        await tx
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, targetUserId),
            ),
          );
      });
      await audit.record({
        actorId: actor.userId,
        workspaceId,
        action: leaving ? "member.left" : "member.removed",
        target: `user:${targetUserId}`,
        ipAddress: actor.ipAddress,
      });
    },

    /** The owner makes another member the owner, and becomes an admin. */
    async transferOwnership(actor: MemberActor, workspaceId: string, newOwnerId: string) {
      await withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, workspaceId, actor.userId);
        if (workspace.role !== "owner")
          throw errors.forbidden("Only the owner can hand over ownership");
        if (newOwnerId === actor.userId)
          throw errors.badRequest("same_owner", "You're already the owner");
        const target = await memberRow(tx, workspaceId, newOwnerId);
        if (!target) throw errors.notFound("Member not found");
        await tx
          .update(workspaceMembers)
          .set({ role: "owner" })
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, newOwnerId),
            ),
          );
        await tx
          .update(workspaces)
          .set({ ownerId: newOwnerId })
          .where(eq(workspaces.id, workspaceId));
        await tx
          .update(workspaceMembers)
          .set({ role: "admin" })
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, actor.userId),
            ),
          );
      });
      await audit.record({
        actorId: actor.userId,
        workspaceId,
        action: "workspace.ownership_transferred",
        target: `user:${newOwnerId}`,
        ipAddress: actor.ipAddress,
      });
    },

    /** The workspace's audit log, newest first, for its owners and admins. */
    async auditLog(
      userId: string,
      workspaceId: string,
      query: { before?: string | undefined; limit: number },
    ): Promise<AuditLogResponse> {
      await withUserContext(db, userId, async (tx) =>
        requireManager((await membership(tx, workspaceId, userId)).role),
      );
      return readAuditLog(db, { workspaceId, ...query });
    },
  };
}

/** Audit events newest first, optionally for one workspace. Shared with the admin API. */
export async function readAuditLog(
  db: Database,
  query: {
    workspaceId?: string | undefined;
    actorId?: string | undefined;
    action?: string | undefined;
    before?: string | undefined;
    limit: number;
  },
): Promise<AuditLogResponse> {
  const actor = aliasedTable(users, "actor");
  const rows = await db
    .select({ event: auditEvents, actorName: actor.name, actorEmail: actor.email })
    .from(auditEvents)
    .leftJoin(actor, eq(actor.id, auditEvents.actorId))
    .where(
      and(
        query.workspaceId ? eq(auditEvents.workspaceId, query.workspaceId) : undefined,
        query.actorId ? eq(auditEvents.actorId, query.actorId) : undefined,
        query.action ? sql`${auditEvents.action} like ${`${query.action}%`}` : undefined,
        query.before ? lt(auditEvents.createdAt, new Date(query.before)) : undefined,
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const events: AuditEvent[] = page.map(({ event, actorName, actorEmail }) => ({
    id: event.id,
    action: event.action,
    actor:
      event.actorId && actorName && actorEmail
        ? { id: event.actorId, name: actorName, email: actorEmail }
        : null,
    workspaceId: event.workspaceId,
    target: event.target,
    metadata: event.metadata,
    ipAddress: event.ipAddress,
    createdAt: event.createdAt.toISOString(),
  }));
  return {
    events,
    nextBefore: rows.length > query.limit ? (events.at(-1)?.createdAt ?? null) : null,
  };
}

export type MembersService = ReturnType<typeof createMembersService>;
