import type {
  AdminModels,
  AdminModelsResponse,
  AdminOverview,
  AdminUsageResponse,
  AdminVoiceResponse,
  AdminUserDetail,
  AdminUserListResponse,
  AuditLogResponse,
} from "@tessel/contracts";
import { VOICE_LATENCY_TARGET_MS } from "@tessel/contracts";
import type { LiveModelRegistry } from "@tessel/ai";
import {
  type Database,
  encodeCursor,
  escapeLike,
  loadModelConfig,
  newestFirst,
  olderThan,
  refreshTokens,
  saveModelConfig,
  userIdentities,
  type UserRow,
  users,
} from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { and, countDistinct, eq, gt, ilike, isNull, or, sql } from "drizzle-orm";
import type { AuditRecorder } from "../../lib/audit";
import { errors } from "../../lib/errors";
import { readAuditLog } from "../members/members.service";
import { usersRepository } from "../users/users.repository";

const DAY_MS = 86_400_000;

export interface AdminActor {
  userId: string;
  ipAddress?: string | undefined;
}

function toAdminUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    emailVerified: row.emailVerifiedAt !== null,
    twoFactorEnabled: row.totpEnabledAt !== null,
    suspended: row.suspendedAt !== null,
  };
}

const num = (value: unknown) => Number(value ?? 0);

/** The admin app's backend: users, the model registry, usage, and the audit log. */
export function createAdminService({
  db,
  logger,
  audit,
  models,
  now = () => new Date(),
}: {
  db: Database;
  logger: Logger;
  audit: AuditRecorder;
  /** The registry the API's AI calls use; saving replaces it straight away. */
  models: LiveModelRegistry;
  now?: () => Date;
}) {
  async function target(userId: string) {
    const user = await usersRepository.findById(db, userId);
    if (!user) throw errors.notFound("User not found");
    return user;
  }

  async function signOutEverywhere(userId: string) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: now() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  return {
    async overview(): Promise<AdminOverview> {
      const result = await db.execute<{ overview: Record<string, unknown> }>(
        sql`SELECT app.admin_overview() AS overview`,
      );
      const raw = result.rows[0]!.overview;
      return Object.fromEntries(
        Object.entries(raw).map(([key, value]) => [key, num(value)]),
      ) as AdminOverview;
    },

    async listUsers(query: {
      query?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    }): Promise<AdminUserListResponse> {
      const pattern = query.query ? `%${escapeLike(query.query)}%` : undefined;
      const rows = await db
        .select()
        .from(users)
        .where(
          and(
            pattern ? or(ilike(users.email, pattern), ilike(users.name, pattern)) : undefined,
            query.cursor ? olderThan(users.createdAt, users.id, query.cursor) : undefined,
          ),
        )
        .orderBy(...newestFirst(users.createdAt, users.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      return {
        users: page.map(toAdminUser),
        nextCursor:
          rows.length > query.limit && page.length
            ? encodeCursor(page.at(-1)!.createdAt, page.at(-1)!.id)
            : null,
      };
    },

    async getUser(userId: string): Promise<AdminUserDetail> {
      const user = await usersRepository.findById(db, userId);
      if (!user) throw errors.notFound("User not found");
      const [identities, sessions, workspaces, cost] = await Promise.all([
        db
          .select({ provider: userIdentities.provider })
          .from(userIdentities)
          .where(eq(userIdentities.userId, userId)),
        db
          .select({ families: countDistinct(refreshTokens.familyId) })
          .from(refreshTokens)
          .where(
            and(
              eq(refreshTokens.userId, userId),
              isNull(refreshTokens.revokedAt),
              gt(refreshTokens.expiresAt, now()),
            ),
          ),
        db.execute<{
          workspace_id: string;
          name: string;
          role: "owner" | "admin" | "member";
          is_personal: boolean;
          member_count: string | number;
        }>(sql`SELECT * FROM app.admin_user_workspaces(${userId})`),
        db.execute<{ cost: string | number }>(
          sql`SELECT app.admin_user_cost(${userId}, ${new Date(now().getTime() - 30 * DAY_MS).toISOString()}::timestamptz) AS cost`,
        ),
      ]);
      return {
        ...toAdminUser(user),
        hasPassword: user.passwordHash !== null,
        phone: user.phoneVerifiedAt ? user.phone : null,
        identities: identities.map((row) => row.provider),
        activeSessions: sessions[0]?.families ?? 0,
        cost30dNanoUsd: num(cost.rows[0]?.cost),
        workspaces: workspaces.rows.map((row) => ({
          id: row.workspace_id,
          name: row.name,
          role: row.role,
          isPersonal: row.is_personal,
          memberCount: num(row.member_count),
        })),
      };
    },

    /** Changes a user's role or suspends them. Admins can't change themselves. */
    async updateUser(
      actor: AdminActor,
      userId: string,
      change: { role?: "user" | "admin" | undefined; suspended?: boolean | undefined },
    ): Promise<AdminUserDetail> {
      if (userId === actor.userId) {
        throw errors.conflict("cannot_change_self", "Ask another admin to change your own account");
      }
      const user = await target(userId);
      if (change.role !== undefined && change.role !== user.role) {
        await db.update(users).set({ role: change.role }).where(eq(users.id, userId));
        await audit.record({
          actorId: actor.userId,
          action: "admin.role_changed",
          target: `user:${userId}`,
          metadata: { from: user.role, to: change.role },
          ipAddress: actor.ipAddress,
        });
      }
      if (change.suspended !== undefined && change.suspended !== (user.suspendedAt !== null)) {
        await db
          .update(users)
          .set({ suspendedAt: change.suspended ? now() : null })
          .where(eq(users.id, userId));
        // Suspending also signs them out; their tokens stop resolving at once.
        if (change.suspended) await signOutEverywhere(userId);
        logger.info({ userId, suspended: change.suspended }, "Account suspension changed");
        await audit.record({
          actorId: actor.userId,
          action: change.suspended ? "admin.user_suspended" : "admin.user_unsuspended",
          target: `user:${userId}`,
          ipAddress: actor.ipAddress,
        });
      }
      return this.getUser(userId);
    },

    async signOutUser(actor: AdminActor, userId: string): Promise<void> {
      await target(userId);
      await signOutEverywhere(userId);
      await audit.record({
        actorId: actor.userId,
        action: "admin.user_signed_out",
        target: `user:${userId}`,
        ipAddress: actor.ipAddress,
      });
    },

    async models(): Promise<AdminModelsResponse> {
      const saved = await loadModelConfig(db);
      const config = models.config();
      return {
        defaults: config.defaults,
        models: config.models,
        source: saved ? "saved" : "file",
        updatedAt: saved?.updatedAt.toISOString() ?? null,
      };
    },

    /**
     * Saves a new registry and switches to it. The embedding model stays
     * fixed: changing it would need every document re-indexed.
     */
    async saveModels(actor: AdminActor, input: AdminModels): Promise<AdminModelsResponse> {
      const current = models.config();
      const embedding = current.models.find((model) => model.id === current.defaults.embedding);
      const nextEmbedding = input.models.find((model) => model.id === input.defaults.embedding);
      if (
        input.defaults.embedding !== current.defaults.embedding ||
        nextEmbedding?.dimensions !== embedding?.dimensions ||
        nextEmbedding?.enabled === false
      ) {
        throw errors.badRequest(
          "embedding_model_fixed",
          "The embedding model can't change here: every document would need re-indexing",
        );
      }
      let validated;
      try {
        // Validates first; the registry in use stays as it was if this throws.
        validated = models.replace(input);
      } catch (error) {
        throw errors.badRequest(
          "invalid_models",
          error instanceof Error && "issues" in error
            ? (error as { issues: { message: string; path: PropertyKey[] }[] }).issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ") || "The registry isn't valid"
            : "The registry isn't valid",
        );
      }
      await saveModelConfig(db, validated as unknown as Record<string, unknown>, actor.userId);
      const enabled = (list: typeof current.models) =>
        list.filter((model) => model.enabled).map((model) => model.id);
      await audit.record({
        actorId: actor.userId,
        action: "admin.models_updated",
        metadata: {
          enabled: enabled(validated.models),
          previouslyEnabled: enabled(current.models),
          defaults: validated.defaults,
        },
        ipAddress: actor.ipAddress,
      });
      return this.models();
    },

    /** How fast voice conversations are: percentiles overall, by day, and by stage. */
    async voice(days: number): Promise<AdminVoiceResponse> {
      const since = new Date(now().getTime() - days * DAY_MS).toISOString();
      const [summary, byDay] = await Promise.all([
        db.execute<Record<string, string | number | null>>(
          sql`SELECT * FROM app.admin_voice_summary(${since}::timestamptz, ${VOICE_LATENCY_TARGET_MS})`,
        ),
        db.execute<{
          day: string | Date;
          turns: string;
          sessions: string;
          p50_ms: number;
          p95_ms: number;
        }>(sql`SELECT * FROM app.admin_voice_by_day(${since}::timestamptz)`),
      ]);
      const row = summary.rows[0] ?? {};
      const int = (value: unknown) =>
        value === null || value === undefined ? null : Number(value);
      const turns = Number(row.turns ?? 0);
      const share = (value: unknown) => (turns > 0 ? Number(value ?? 0) / turns : 0);
      return {
        targetMs: VOICE_LATENCY_TARGET_MS,
        sessions: Number(row.sessions ?? 0),
        turns,
        userAudioMinutes: Number(row.user_audio_ms ?? 0) / 60_000,
        p50Ms: int(row.p50_ms),
        p95Ms: int(row.p95_ms),
        withinTarget: share(row.within_target),
        preemptive: share(row.preemptive),
        interrupted: share(row.interrupted),
        stages: {
          endOfTurnMs: int(row.end_of_turn_p50_ms),
          modelFirstTokenMs: int(row.model_first_token_p50_ms),
          firstAudioMs: int(row.first_audio_p50_ms),
        },
        days: byDay.rows.map((day) => ({
          day:
            day.day instanceof Date
              ? day.day.toISOString().slice(0, 10)
              : String(day.day).slice(0, 10),
          turns: Number(day.turns),
          sessions: Number(day.sessions),
          p50Ms: Number(day.p50_ms),
          p95Ms: Number(day.p95_ms),
        })),
      };
    },

    async usage(days: number): Promise<AdminUsageResponse> {
      const since = new Date(now().getTime() - days * DAY_MS).toISOString();
      const [byDay, topWorkspaces, topUsers] = await Promise.all([
        db.execute<{
          day: string | Date;
          model_id: string;
          calls: string;
          input_tokens: string;
          output_tokens: string;
          cost_nano_usd: string;
        }>(sql`SELECT * FROM app.admin_usage_by_day(${since}::timestamptz)`),
        db.execute<{ workspace_id: string; name: string; calls: string; cost_nano_usd: string }>(
          sql`SELECT * FROM app.admin_top_workspaces(${since}::timestamptz, 10)`,
        ),
        db.execute<{
          user_id: string;
          name: string;
          email: string;
          calls: string;
          cost_nano_usd: string;
        }>(sql`SELECT * FROM app.admin_top_users(${since}::timestamptz, 10)`),
      ]);
      const dayTotals = new Map<string, { calls: number; costNanoUsd: number }>();
      const modelTotals = new Map<
        string,
        { calls: number; inputTokens: number; outputTokens: number; costNanoUsd: number }
      >();
      for (const row of byDay.rows) {
        const day =
          row.day instanceof Date
            ? row.day.toISOString().slice(0, 10)
            : String(row.day).slice(0, 10);
        const totals = dayTotals.get(day) ?? { calls: 0, costNanoUsd: 0 };
        totals.calls += num(row.calls);
        totals.costNanoUsd += num(row.cost_nano_usd);
        dayTotals.set(day, totals);
        const model = modelTotals.get(row.model_id) ?? {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costNanoUsd: 0,
        };
        model.calls += num(row.calls);
        model.inputTokens += num(row.input_tokens);
        model.outputTokens += num(row.output_tokens);
        model.costNanoUsd += num(row.cost_nano_usd);
        modelTotals.set(row.model_id, model);
      }
      return {
        days: [...dayTotals.entries()].map(([day, totals]) => ({ day, ...totals })),
        models: [...modelTotals.entries()]
          .map(([modelId, totals]) => ({ modelId, ...totals }))
          .sort((a, b) => b.costNanoUsd - a.costNanoUsd),
        topWorkspaces: topWorkspaces.rows.map((row) => ({
          id: row.workspace_id,
          name: row.name,
          calls: num(row.calls),
          costNanoUsd: num(row.cost_nano_usd),
        })),
        topUsers: topUsers.rows.map((row) => ({
          id: row.user_id,
          name: row.name,
          email: row.email,
          calls: num(row.calls),
          costNanoUsd: num(row.cost_nano_usd),
        })),
      };
    },

    auditLog(query: {
      actorId?: string | undefined;
      workspaceId?: string | undefined;
      action?: string | undefined;
      before?: string | undefined;
      limit: number;
    }): Promise<AuditLogResponse> {
      return readAuditLog(db, query);
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
