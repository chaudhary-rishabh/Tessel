import { sql } from "drizzle-orm";
import type { Database } from "./client";

export interface MaintenanceReport {
  refreshTokensDeleted: number;
  accessTokensDeleted: number;
  waitingRunsExpired: number;
  agentRunsDeleted: number;
  oauthStatesCleared: number;
  signupsDeleted: number;
  passwordResetsDeleted: number;
  loginTicketsDeleted: number;
  phoneCodesDeleted: number;
  oauthAuthorizationsDeleted: number;
  oauthAccessTokensDeleted: number;
  oauthGrantsDeleted: number;
  invitationsDeleted: number;
  auditEventsDeleted: number;
}

/**
 * Daily housekeeping (see 0013_maintenance.sql, extended in 0014 to 0017): old refresh and access
 * tokens, approvals nobody answered for a week, old agent checkpoints, and
 * abandoned connector sign-ins, and expired signup codes, reset links, sign-in tickets, phone codes, finished MCP client sign-ins, old invitations, and audit events after a year.
 */
export async function runMaintenance(db: Database): Promise<MaintenanceReport> {
  const result = await db.execute<{ report: MaintenanceReport }>(
    sql`SELECT app.run_maintenance() AS report`,
  );
  return result.rows[0]!.report;
}
