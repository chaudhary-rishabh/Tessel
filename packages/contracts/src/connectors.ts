import { z } from "zod";

export const connectorAuthSchema = z.enum(["none", "token", "oauth"]);
export const toolPolicySchema = z.enum(["auto", "ask", "allow", "off"]);

/** An app Tessel knows how to connect to. */
export const connectorCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** How users sign in: OAuth when the app supports it here, otherwise a token. */
  auth: connectorAuthSchema,
  /** For token sign-in: where to create one, and what it needs. */
  tokenHelp: z.string().nullable(),
});

export const connectorToolSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  readOnly: z.boolean(),
  destructive: z.boolean(),
  policy: toolPolicySchema,
});

/** One of the signed-in user's connections. Credentials never leave the server. */
export const connectorConnectionSchema = z.object({
  id: z.uuid(),
  catalogId: z.string().nullable(),
  name: z.string(),
  serverUrl: z.string(),
  auth: connectorAuthSchema,
  status: z.enum(["pending", "connected", "needs_auth", "error"]),
  lastError: z.string().nullable(),
  enabled: z.boolean(),
  tools: z.array(connectorToolSchema),
  createdAt: z.iso.datetime(),
});

export const connectorListResponseSchema = z.object({
  catalog: z.array(connectorCatalogEntrySchema),
  connections: z.array(connectorConnectionSchema),
});

export const createConnectionRequestSchema = z
  .object({
    /** A catalog entry, or omit and give a URL for a custom server. */
    catalogId: z.string().max(40).optional(),
    name: z.string().trim().min(1, "Give the connector a name").max(60).optional(),
    serverUrl: z.string().trim().max(500).optional(),
    auth: connectorAuthSchema.optional(),
    token: z.string().trim().min(1, "Paste a token").max(4_000).optional(),
  })
  .refine((value) => value.catalogId || value.serverUrl, {
    message: "Pick an app or enter a server URL",
    path: ["serverUrl"],
  });

export const createConnectionResponseSchema = z.object({
  connection: connectorConnectionSchema,
  /** For OAuth: where to send the user to sign in. */
  authorizationUrl: z.string().nullable(),
});

export const updateConnectionRequestSchema = z
  .object({
    enabled: z.boolean(),
    toolPolicies: z.record(z.string().max(200), toolPolicySchema),
    token: z.string().trim().min(1).max(4_000),
  })
  .partial();

export const connectionParamsSchema = z.object({
  workspaceId: z.uuid("Invalid workspace ID"),
  connectionId: z.uuid("Invalid connection ID"),
});

export type ConnectorCatalogEntry = z.infer<typeof connectorCatalogEntrySchema>;
export type ConnectorConnection = z.infer<typeof connectorConnectionSchema>;
export type ConnectorTool = z.infer<typeof connectorToolSchema>;
export type ConnectorListResponse = z.infer<typeof connectorListResponseSchema>;
export type CreateConnectionRequest = z.infer<typeof createConnectionRequestSchema>;
export type CreateConnectionResponse = z.infer<typeof createConnectionResponseSchema>;
export type UpdateConnectionRequest = z.infer<typeof updateConnectionRequestSchema>;
export type ToolPolicyName = z.infer<typeof toolPolicySchema>;
