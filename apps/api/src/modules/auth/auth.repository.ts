import { refreshTokens, type Executor, type RefreshTokenRow, type Transaction } from "@tessel/db";
import { and, eq, isNull } from "drizzle-orm";

export interface NewRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export const refreshTokenRepository = {
  async insert(db: Executor, values: NewRefreshToken): Promise<RefreshTokenRow> {
    const [row] = await db.insert(refreshTokens).values(values).returning();
    if (!row) throw new Error("Failed to insert refresh token");
    return row;
  },

  async findByHash(db: Executor, tokenHash: string): Promise<RefreshTokenRow | undefined> {
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row;
  },

  /** Locks the row so two concurrent refreshes of the same token run one after the other. */
  async findByHashForUpdate(
    tx: Transaction,
    tokenHash: string,
  ): Promise<RefreshTokenRow | undefined> {
    const [row] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)
      .for("update");
    return row;
  },

  async markRotated(db: Executor, id: string, replacedById: string, at: Date): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: at, replacedById })
      .where(eq(refreshTokens.id, id));
  },

  /** Ends one login session (every token in the family). */
  async revokeFamily(db: Executor, familyId: string, at: Date): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: at })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  },

  /** Ends every session for a user, for example after a password change. */
  async revokeAllForUser(db: Executor, userId: string, at: Date): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: at })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  },
};
