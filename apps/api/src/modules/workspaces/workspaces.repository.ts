import type { Workspace, WorkspaceRole } from "@tessel/contracts";
import { workspaceMembers, workspaces, type Transaction } from "@tessel/db";
import { and, asc, desc, eq } from "drizzle-orm";

interface WorkspaceWithRole {
  id: string;
  name: string;
  isPersonal: boolean;
  createdAt: Date;
  role: WorkspaceRole;
}

export function toWorkspace(row: WorkspaceWithRole): Workspace {
  return {
    id: row.id,
    name: row.name,
    isPersonal: row.isPersonal,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

const workspaceWithRole = {
  id: workspaces.id,
  name: workspaces.name,
  isPersonal: workspaces.isPersonal,
  createdAt: workspaces.createdAt,
  role: workspaceMembers.role,
};

/**
 * Every query here runs inside withUserContext, so row-level security also
 * applies. The explicit membership joins are the first line of defence; RLS is
 * the second, in case a query ever forgets its filter.
 */
export const workspacesRepository = {
  async createWithOwner(
    tx: Transaction,
    values: { name: string; ownerId: string; isPersonal: boolean },
  ): Promise<WorkspaceWithRole> {
    const [workspace] = await tx.insert(workspaces).values(values).returning();
    if (!workspace) throw new Error("Failed to insert workspace");
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: values.ownerId, role: "owner" });
    return { ...workspace, role: "owner" };
  },

  async listForUser(tx: Transaction, userId: string): Promise<WorkspaceWithRole[]> {
    return tx
      .select(workspaceWithRole)
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
      )
      .orderBy(desc(workspaces.isPersonal), asc(workspaces.createdAt));
  },

  async findForUser(
    tx: Transaction,
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceWithRole | undefined> {
    const [row] = await tx
      .select(workspaceWithRole)
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
      )
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return row;
  },

  async rename(tx: Transaction, workspaceId: string, name: string): Promise<boolean> {
    const updated = await tx
      .update(workspaces)
      .set({ name })
      .where(eq(workspaces.id, workspaceId))
      .returning({ id: workspaces.id });
    return updated.length > 0;
  },
};
