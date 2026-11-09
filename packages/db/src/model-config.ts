import { eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { aiModelConfig } from "./schema/settings";

/** The saved model registry, or null when none was saved (the bundled one applies). */
export async function loadModelConfig(
  db: Database,
): Promise<{ config: Record<string, unknown>; updatedAt: Date } | null> {
  const [row] = await db.select().from(aiModelConfig).where(eq(aiModelConfig.id, 1));
  return row ? { config: row.config, updatedAt: row.updatedAt } : null;
}

/** Saves the whole registry. Callers validate it first. */
export async function saveModelConfig(
  db: Database,
  config: Record<string, unknown>,
  updatedBy: string | null,
): Promise<void> {
  await db
    .insert(aiModelConfig)
    .values({ id: 1, config, updatedBy })
    .onConflictDoUpdate({
      target: aiModelConfig.id,
      set: { config, updatedBy, updatedAt: sql`now()` },
    });
}
