import type { WorkspaceRole } from "@tessel/contracts";

/** Row-level security applies the same rule to the ledger itself. */
export const usagePolicy = {
  canSeeWorkspaceUsage: (role: WorkspaceRole): boolean => role === "owner" || role === "admin",
};
