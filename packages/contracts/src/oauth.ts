import { z } from "zod";

/** A sign-in from an outside MCP client, waiting for the user to allow it. */
export const oauthAuthorizationSchema = z.object({
  id: z.uuid(),
  client: z.object({
    name: z.string(),
    /** The client's homepage, if it gave one. */
    uri: z.string().nullable(),
  }),
  /** Where the browser goes back to, shown so the user can spot a lookalike. */
  redirectHost: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.iso.datetime(),
});

export const oauthAuthorizationParamsSchema = z.object({ authorizationId: z.uuid() });
export const approveOAuthRequestSchema = z.object({ workspaceId: z.uuid() });
/** Where to send the browser next: back to the client, with a code or an error. */
export const oauthRedirectResponseSchema = z.object({ redirectUrl: z.url() });

/** An MCP client the user allowed into a workspace. */
export const connectedAppSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  workspace: z.object({ id: z.uuid(), name: z.string() }),
  scopes: z.array(z.string()),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export const connectedAppListResponseSchema = z.object({ apps: z.array(connectedAppSchema) });
export const connectedAppParamsSchema = z.object({ appId: z.uuid() });

export type OAuthAuthorization = z.infer<typeof oauthAuthorizationSchema>;
export type ConnectedApp = z.infer<typeof connectedAppSchema>;
