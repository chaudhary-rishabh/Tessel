import { sql } from "drizzle-orm";
import type { Database } from "./client";

export interface MaintenanceReport {
  refreshTokensDeleted: number;
  accessTokensDeleted: number;
  waitingRunsExpired: number;
  agentRunsDeleted: number;
  oauthStatesCleared: number;
}

/**
 * Daily housekeeping (see 0013_maintenance.sql): old refresh and access
 * tokens, approvals nobody answered for a week, old agent checkpoints, and
 * abandoned connector sign-ins.
 */
export async function runMaintenance(db: Database): Promise<MaintenanceReport> {
  const result = await db.execute<{ report: MaintenanceReport }>(
    sql`SELECT app.run_maintenance() AS report`,
  );
  return result.rows[0]!.report;
}
