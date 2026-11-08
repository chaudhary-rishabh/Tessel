import type { Workspace } from "@tessel/contracts";
import { withUserContext, type Database } from "@tessel/db";
import { noAudit, type AuditRecorder } from "../../lib/audit";
import { errors } from "../../lib/errors";
import { workspacePolicy } from "./workspaces.policy";
import { toWorkspace, workspacesRepository } from "./workspaces.repository";

/**
 * Workspaces a user doesn't belong to are reported as not found, never
 * forbidden, so their existence is not revealed.
 */
export function createWorkspacesService({
  db,
  audit = noAudit,
}: {
  db: Database;
  audit?: AuditRecorder;
}) {
  return {
    list(userId: string): Promise<Workspace[]> {
      return withUserContext(db, userId, async (tx) =>
        (await workspacesRepository.listForUser(tx, userId)).map(toWorkspace),
      );
    },

    async create(userId: string, name: string): Promise<Workspace> {
      const workspace = await withUserContext(db, userId, async (tx) =>
        toWorkspace(
          await workspacesRepository.createWithOwner(tx, {
            name,
            ownerId: userId,
            isPersonal: false,
          }),
        ),
      );
      await audit.record({
        actorId: userId,
        workspaceId: workspace.id,
        action: "workspace.created",
        metadata: { name },
      });
      return workspace;
    },

    get(userId: string, workspaceId: string): Promise<Workspace> {
      return withUserContext(db, userId, async (tx) => {
        const workspace = await workspacesRepository.findForUser(tx, workspaceId, userId);
        if (!workspace) throw errors.notFound("Workspace not found");
        return toWorkspace(workspace);
      });
    },

    async rename(userId: string, workspaceId: string, name: string): Promise<Workspace> {
      const renamed = await withUserContext(db, userId, async (tx) => {
        const workspace = await workspacesRepository.findForUser(tx, workspaceId, userId);
        if (!workspace) throw errors.notFound("Workspace not found");
        if (!workspacePolicy.canRename(workspace.role)) {
          throw errors.forbidden("Only owners and admins can rename a workspace");
        }
        await workspacesRepository.rename(tx, workspaceId, name);
        return { workspace: toWorkspace({ ...workspace, name }), previous: workspace.name };
      });
      await audit.record({
        actorId: userId,
        workspaceId,
        action: "workspace.renamed",
        metadata: { from: renamed.previous, to: name },
      });
      return renamed.workspace;
    },
  };
}

export type WorkspacesService = ReturnType<typeof createWorkspacesService>;
