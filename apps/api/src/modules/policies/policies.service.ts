import type { ToolDefinition } from "@tessel/ai";
import {
  updateWorkspacePoliciesSchema,
  type WorkspacePolicies,
  type WorkspaceToolPolicy,
} from "@tessel/contracts";
import { withUserContext, workspacePolicies, type Database } from "@tessel/db";
import { eq } from "drizzle-orm";
import type { AuditRecorder } from "../../lib/audit";
import { errors } from "../../lib/errors";
import { workspacesRepository } from "../workspaces/workspaces.repository";

export interface Actor {
  userId: string;
  workspaceId: string;
  requestId?: string;
}

/** Tessel's own tools, which workspace policies cover. Connector tools have their own settings. */
export const GOVERNABLE_TOOLS: { name: string; title: string; asksByDefault: boolean }[] = [
  { name: "search_documents", title: "Search documents", asksByDefault: false },
  { name: "list_documents", title: "List documents", asksByDefault: false },
  { name: "create_document", title: "Create a document", asksByDefault: true },
  { name: "delete_document", title: "Delete a document", asksByDefault: true },
  { name: "generate_image", title: "Generate an image", asksByDefault: false },
  { name: "edit_image", title: "Edit an image", asksByDefault: false },
  { name: "generate_video", title: "Make a video", asksByDefault: true },
  { name: "remember", title: "Remember", asksByDefault: false },
  { name: "remember_for_team", title: "Remember for the team", asksByDefault: true },
  { name: "search_past_chats", title: "Search past chats", asksByDefault: false },
  { name: "calculator", title: "Calculate", asksByDefault: false },
  { name: "current_time", title: "Check the time", asksByDefault: false },
];

export interface EffectivePolicies {
  toolPolicies: Record<string, WorkspaceToolPolicy>;
  blockedConnectors: string[];
  disabledSkills: string[];
}

const NONE: EffectivePolicies = { toolPolicies: {}, blockedConnectors: [], disabledSkills: [] };

/**
 * Applies the workspace's tool policies: blocked tools are left out, "ask"
 * makes a tool wait for approval, and "allow" lets it run without asking.
 */
export function applyToolPolicies(
  tools: ToolDefinition[],
  policies: Pick<EffectivePolicies, "toolPolicies">,
): ToolDefinition[] {
  return tools.flatMap((tool) => {
    const policy = policies.toolPolicies[tool.name];
    if (policy === "block") return [];
    if (policy === "ask" && tool.risk === "read") return [{ ...tool, risk: "write" as const }];
    if (policy === "allow" && tool.risk !== "read") return [{ ...tool, risk: "read" as const }];
    return [tool];
  });
}

/** Workspace policies: owners and admins set them, everyone's agent follows them. */
export function createPoliciesService({ db, audit }: { db: Database; audit: AuditRecorder }) {
  async function current(workspaceId: string, userId: string): Promise<EffectivePolicies> {
    const [row] = await withUserContext(db, userId, (tx) =>
      tx.select().from(workspacePolicies).where(eq(workspacePolicies.workspaceId, workspaceId)),
    );
    return row
      ? {
          toolPolicies: row.toolPolicies,
          blockedConnectors: row.blockedConnectors,
          disabledSkills: row.disabledSkills,
        }
      : NONE;
  }

  return {
    /** What the agent follows in a workspace; no policies when there are none. */
    forWorkspace: (actor: Actor) => current(actor.workspaceId, actor.userId),

    async get(actor: Actor): Promise<WorkspacePolicies> {
      const workspace = await withUserContext(db, actor.userId, (tx) =>
        workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId),
      );
      if (!workspace) throw errors.notFound("Workspace not found");
      return {
        ...(await current(actor.workspaceId, actor.userId)),
        tools: GOVERNABLE_TOOLS,
        canEdit: workspace.role === "owner" || workspace.role === "admin",
      };
    },

    async update(actor: Actor, input: unknown): Promise<WorkspacePolicies> {
      const request = updateWorkspacePoliciesSchema.parse(input);
      const known = new Set(GOVERNABLE_TOOLS.map((tool) => tool.name));
      const unknown = Object.keys(request.toolPolicies ?? {}).filter((name) => !known.has(name));
      if (unknown.length) {
        throw errors.badRequest("unknown_tool", `There's no tool called ${unknown.join(", ")}`);
      }
      await withUserContext(db, actor.userId, async (tx) => {
        const workspace = await workspacesRepository.findForUser(
          tx,
          actor.workspaceId,
          actor.userId,
        );
        if (!workspace) throw errors.notFound("Workspace not found");
        if (workspace.role !== "owner" && workspace.role !== "admin") {
          throw errors.forbidden("Only owners and admins can change workspace policies");
        }
        const values = {
          ...(request.toolPolicies ? { toolPolicies: request.toolPolicies } : {}),
          ...(request.blockedConnectors
            ? { blockedConnectors: [...new Set(request.blockedConnectors)] }
            : {}),
          ...(request.disabledSkills
            ? { disabledSkills: [...new Set(request.disabledSkills)] }
            : {}),
          updatedBy: actor.userId,
        };
        await tx
          .insert(workspacePolicies)
          .values({ workspaceId: actor.workspaceId, ...values })
          .onConflictDoUpdate({ target: workspacePolicies.workspaceId, set: values });
      });
      await audit.record({
        actorId: actor.userId,
        workspaceId: actor.workspaceId,
        action: "workspace.policies_updated",
        target: `workspace:${actor.workspaceId}`,
        metadata: request as Record<string, unknown>,
      });
      return this.get(actor);
    },
  };
}

export type PoliciesService = ReturnType<typeof createPoliciesService>;
