import { z } from "zod";

/** How the agent may use a tool: always ask first, never ask, or not at all. */
export const workspaceToolPolicySchema = z.enum(["ask", "allow", "block"]);
export type WorkspaceToolPolicy = z.infer<typeof workspaceToolPolicySchema>;

/** A tool the workspace can set a policy for. */
export const governableToolSchema = z.object({
  name: z.string(),
  title: z.string(),
  /** Whether it asks for approval when there's no policy. */
  asksByDefault: z.boolean(),
});

export const workspacePoliciesSchema = z.object({
  toolPolicies: z.record(z.string(), workspaceToolPolicySchema),
  /** Connector catalog IDs (or names, for custom servers) nobody may use. */
  blockedConnectors: z.array(z.string()),
  /** Built-in skills turned off for the workspace. */
  disabledSkills: z.array(z.string()),
  /** The tools policies apply to. */
  tools: z.array(governableToolSchema),
  /** Whether the signed-in user can change them (owners and admins). */
  canEdit: z.boolean(),
});
export type WorkspacePolicies = z.infer<typeof workspacePoliciesSchema>;

export const updateWorkspacePoliciesSchema = z.object({
  toolPolicies: z
    .record(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), workspaceToolPolicySchema)
    .optional(),
  blockedConnectors: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  disabledSkills: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});
export type UpdateWorkspacePolicies = z.infer<typeof updateWorkspacePoliciesSchema>;
