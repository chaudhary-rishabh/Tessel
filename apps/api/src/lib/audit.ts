import { auditEvents, type Database } from "@tessel/db";
import type { Logger } from "@tessel/logger";

export interface AuditEntry {
  /** Who did it; null for system actions and failed sign-ins. */
  actorId?: string | null | undefined;
  workspaceId?: string | null | undefined;
  /** Like "member.invited"; see AUDIT_ACTIONS in docs/ARCHITECTURE.md. */
  action: string;
  /** What it was done to, like "user:<id>". */
  target?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  ipAddress?: string | undefined;
}

/** Records audit events. Never throws: a failed write is logged, and the action still goes ahead. */
export interface AuditRecorder {
  record(entry: AuditEntry): Promise<void>;
}

export function createAuditRecorder({
  db,
  logger,
}: {
  db: Database;
  logger: Logger;
}): AuditRecorder {
  return {
    async record(entry) {
      try {
        await db.insert(auditEvents).values({
          actorId: entry.actorId ?? null,
          workspaceId: entry.workspaceId ?? null,
          action: entry.action,
          target: entry.target ?? null,
          metadata: entry.metadata ?? {},
          ipAddress: entry.ipAddress ?? null,
        });
      } catch (error) {
        logger.error({ err: error, action: entry.action }, "Could not record an audit event");
      }
    },
  };
}

/** For tests and callers that don't keep an audit log. */
export const noAudit: AuditRecorder = { record: async () => undefined };
