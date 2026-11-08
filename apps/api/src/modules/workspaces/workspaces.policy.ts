import type { WorkspaceRole } from "@tessel/contracts";

/**
 * What each workspace role may do. Row-level security in Postgres enforces
 * the same rules underneath, so a bug here cannot expose another workspace.
 */
export const workspacePolicy = {
  canRename: (role: WorkspaceRole): boolean => role === "owner" || role === "admin",
};
