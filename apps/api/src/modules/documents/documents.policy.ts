import type { WorkspaceRole } from "@tessel/contracts";

/** Row-level security enforces the same rules in Postgres. */
export const documentsPolicy = {
  canManage: (role: WorkspaceRole, uploaderId: string, userId: string): boolean =>
    uploaderId === userId || role === "owner" || role === "admin",
};
