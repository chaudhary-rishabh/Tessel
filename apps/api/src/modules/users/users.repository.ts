import { users, type Executor, type UserRow } from "@tessel/db";
import { eq } from "drizzle-orm";

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string | null;
  emailVerifiedAt?: Date | null;
}

export const usersRepository = {
  async insert(db: Executor, values: NewUser): Promise<UserRow> {
    const [row] = await db.insert(users).values(values).returning();
    if (!row) throw new Error("Failed to insert user");
    return row;
  },

  async findByEmail(db: Executor, email: string): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  },

  async findById(db: Executor, id: string): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  },

  async updatePassword(db: Executor, id: string, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, id));
  },

  async touchLastLogin(db: Executor, id: string, at: Date): Promise<void> {
    await db.update(users).set({ lastLoginAt: at }).where(eq(users.id, id));
  },
};
