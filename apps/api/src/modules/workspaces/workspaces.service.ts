import type { Workspace } from "@tessel/contracts";
import {
  documents,
  withUserContext,
  workspaceMembers,
  workspaces,
  type Database,
} from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { eq } from "drizzle-orm";
import { noAudit, type AuditRecorder } from "../../lib/audit";
import { errors } from "../../lib/errors";
import { workspacePolicy } from "./workspaces.policy";
import { toWorkspace, workspacesRepository } from "./workspaces.repository";

/** What lives outside Postgres for a workspace, removed when it's deleted. */
export interface WorkspaceContents {
  workspaceId: string;
  documentIds: string[];
  memberIds: string[];
}

/**
 * Workspaces a user doesn't belong to are reported as not found, never
 * forbidden, so their existence is not revealed.
 */
export function createWorkspacesService({
  db,
  audit = noAudit,
  billing,
  purge,
  logger,
}: {
  db: Database;
  audit?: AuditRecorder;
  /** Ends the subscription first; throws if the provider refuses. */
  billing?: { endForDeletion(workspaceId: string): Promise<void> } | undefined;
  /** Removes files, search index entries, graph data, and chat search for the workspace. */
  purge?: ((contents: WorkspaceContents) => Promise<void>) | undefined;
  logger?: Logger | undefined;
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

    /**
     * Deletes a team workspace: the subscription ends at once, outside data
     * (files, search, graph) goes next, then the rows, which cascade.
     */
    async remove(
      userId: string,
      workspaceId: string,
      confirmName: string,
      ipAddress?: string,
    ): Promise<void> {
      const contents = await withUserContext(db, userId, async (tx) => {
        const workspace = await workspacesRepository.findForUser(tx, workspaceId, userId);
        if (!workspace) throw errors.notFound("Workspace not found");
        if (!workspacePolicy.canDelete(workspace.role)) {
          throw errors.forbidden("Only the owner can delete a workspace");
        }
        if (workspace.isPersonal) {
          throw errors.badRequest(
            "personal_workspace",
            "Your personal workspace can't be deleted. Delete your account instead.",
          );
        }
        if (confirmName.trim() !== workspace.name) {
          throw errors.badRequest(
            "name_mismatch",
            "That isn't this workspace's name. Type it exactly to delete the workspace.",
          );
        }
        const documentRows = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.workspaceId, workspaceId));
        const memberRows = await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, workspaceId));
        return {
          name: workspace.name,
          workspaceId,
          documentIds: documentRows.map((row) => row.id),
          memberIds: memberRows.map((row) => row.userId),
        };
      });

      await billing?.endForDeletion(workspaceId);
      await purge?.(contents);
      await withUserContext(db, userId, (tx) =>
        tx.delete(workspaces).where(eq(workspaces.id, workspaceId)),
      );
      logger?.info({ workspaceId, documents: contents.documentIds.length }, "Workspace deleted");
      await audit.record({
        actorId: userId,
        action: "workspace.deleted",
        target: `workspace:${workspaceId}`,
        metadata: { name: contents.name, members: contents.memberIds.length },
        ipAddress,
      });
    },
  };
}

export type WorkspacesService = ReturnType<typeof createWorkspacesService>;
