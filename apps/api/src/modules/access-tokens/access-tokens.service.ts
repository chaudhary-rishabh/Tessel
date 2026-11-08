import { createHash, randomBytes } from "node:crypto";
import {
  createAccessTokenRequestSchema,
  type AccessToken,
  type AccessTokenScope,
  type CreateAccessTokenResponse,
  type UserRole,
} from "@tessel/contracts";
import {
  personalAccessTokens,
  withUserContext,
  type Database,
  type PersonalAccessTokenRow,
} from "@tessel/db";
import { and, count, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { errors } from "../../lib/errors";
import { workspacesRepository } from "../workspaces/workspaces.repository";

export interface Actor {
  userId: string;
  workspaceId: string;
}

/** Who a personal access token acts as, and what it may do. */
export interface TokenIdentity {
  tokenId: string;
  userId: string;
  workspaceId: string;
  scopes: AccessTokenScope[];
  role: UserRole;
}

export const TOKEN_PREFIX = "tsl_pat_";
/** Hour-long tokens issued to OAuth clients; stored and checked like personal ones. */
export const OAUTH_TOKEN_PREFIX = "tsl_oat_";
const MAX_ACTIVE_TOKENS = 20;
const DAY_MS = 86_400_000;
const TOUCH_INTERVAL = sql`interval '1 minute'`;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function toAccessToken(row: PersonalAccessTokenRow): AccessToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes as AccessTokenScope[],
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Personal access tokens for outside tools such as MCP clients. A token acts
 * as its owner in one workspace, with limited scopes; only its hash is stored.
 */
export function createAccessTokensService({ db }: { db: Database }) {
  // Tokens made by hand; OAuth clients' tokens are managed through their grants.
  const live = (actor: Actor) =>
    and(
      eq(personalAccessTokens.userId, actor.userId),
      eq(personalAccessTokens.workspaceId, actor.workspaceId),
      isNull(personalAccessTokens.grantId),
      isNull(personalAccessTokens.revokedAt),
      or(isNull(personalAccessTokens.expiresAt), sql`${personalAccessTokens.expiresAt} > now()`),
    );

  return {
    async list(actor: Actor): Promise<AccessToken[]> {
      return withUserContext(db, actor.userId, async (tx) => {
        const workspace = await workspacesRepository.findForUser(
          tx,
          actor.workspaceId,
          actor.userId,
        );
        if (!workspace) throw errors.notFound("Workspace not found");
        const rows = await tx
          .select()
          .from(personalAccessTokens)
          .where(live(actor))
          .orderBy(desc(personalAccessTokens.createdAt));
        return rows.map(toAccessToken);
      });
    },

    async create(actor: Actor, input: unknown): Promise<CreateAccessTokenResponse> {
      const request = createAccessTokenRequestSchema.parse(input);
      const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
      return withUserContext(db, actor.userId, async (tx) => {
        const workspace = await workspacesRepository.findForUser(
          tx,
          actor.workspaceId,
          actor.userId,
        );
        if (!workspace) throw errors.notFound("Workspace not found");
        const [active] = await tx
          .select({ total: count() })
          .from(personalAccessTokens)
          .where(live(actor));
        if ((active?.total ?? 0) >= MAX_ACTIVE_TOKENS) {
          throw errors.conflict(
            "too_many_tokens",
            "Revoke a token you no longer use before making another",
          );
        }
        const [row] = await tx
          .insert(personalAccessTokens)
          .values({
            userId: actor.userId,
            workspaceId: actor.workspaceId,
            name: request.name,
            tokenHash: hash(token),
            prefix: token.slice(0, TOKEN_PREFIX.length + 4),
            scopes: [...new Set(request.scopes)],
            expiresAt: request.expiresInDays
              ? new Date(Date.now() + request.expiresInDays * DAY_MS)
              : null,
          })
          .returning();
        return { token, accessToken: toAccessToken(row!) };
      });
    },

    async revoke(actor: Actor, tokenId: string): Promise<void> {
      const revoked = await withUserContext(db, actor.userId, (tx) =>
        tx
          .update(personalAccessTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(personalAccessTokens.id, tokenId), live(actor)))
          .returning({ id: personalAccessTokens.id }),
      );
      if (revoked.length === 0) throw errors.notFound("Token not found");
    },

    /** Finds who a token acts as, or null if it isn't valid now. Notes when it was last used. */
    async resolve(token: string): Promise<TokenIdentity | null> {
      if (!token.startsWith(TOKEN_PREFIX) && !token.startsWith(OAUTH_TOKEN_PREFIX)) return null;
      const result = await db.execute<{
        token_id: string;
        user_id: string;
        workspace_id: string;
        scopes: string[];
        role: UserRole;
      }>(sql`SELECT * FROM app.resolve_access_token(${hash(token)})`);
      const row = result.rows[0];
      if (!row) return null;
      // At most once a minute, so busy clients don't write on every request.
      await withUserContext(db, row.user_id, (tx) =>
        tx
          .update(personalAccessTokens)
          .set({ lastUsedAt: new Date() })
          .where(
            and(
              eq(personalAccessTokens.id, row.token_id),
              or(
                isNull(personalAccessTokens.lastUsedAt),
                lt(personalAccessTokens.lastUsedAt, sql`now() - ${TOUCH_INTERVAL}`),
              ),
            ),
          ),
      );
      return {
        tokenId: row.token_id,
        userId: row.user_id,
        workspaceId: row.workspace_id,
        scopes: row.scopes as AccessTokenScope[],
        role: row.role,
      };
    },
  };
}

export type AccessTokensService = ReturnType<typeof createAccessTokensService>;
