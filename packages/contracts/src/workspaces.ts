import { z } from "zod";

export const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);

export const workspaceNameSchema = z.string().trim().min(1, "Name is required").max(80);

/** A workspace as seen by one member, including that member's role. */
export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isPersonal: z.boolean(),
  role: workspaceRoleSchema,
  createdAt: z.iso.datetime(),
});

export const workspaceListResponseSchema = z.object({
  workspaces: z.array(workspaceSchema),
});

export const createWorkspaceRequestSchema = z.object({ name: workspaceNameSchema });
export const updateWorkspaceRequestSchema = z.object({ name: workspaceNameSchema });
export const workspaceParamsSchema = z.object({ workspaceId: z.uuid("Invalid workspace ID") });

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;
