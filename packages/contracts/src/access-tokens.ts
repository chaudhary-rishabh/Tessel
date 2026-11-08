import { z } from "zod";

/** What a personal access token may do. */
export const accessTokenScopeSchema = z.enum(["documents:read"]);
export const ACCESS_TOKEN_SCOPES = accessTokenScopeSchema.options;

export const accessTokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The first characters of the token, to tell tokens apart. */
  prefix: z.string(),
  scopes: z.array(accessTokenScopeSchema),
  lastUsedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const accessTokenListResponseSchema = z.object({ tokens: z.array(accessTokenSchema) });

export const createAccessTokenRequestSchema = z.object({
  name: z.string().trim().min(1, "Name the token after where you'll use it").max(60),
  /** Days until it stops working, or null for no expiry. */
  expiresInDays: z
    .union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.null()])
    .default(90),
  scopes: z.array(accessTokenScopeSchema).min(1).default(["documents:read"]),
});

/** The token itself appears only in this response. */
export const createAccessTokenResponseSchema = z.object({
  token: z.string(),
  accessToken: accessTokenSchema,
});

export const accessTokenParamsSchema = z.object({
  workspaceId: z.uuid("Invalid workspace ID"),
  tokenId: z.uuid("Invalid token ID"),
});

export type AccessToken = z.infer<typeof accessTokenSchema>;
export type AccessTokenScope = z.infer<typeof accessTokenScopeSchema>;
export type CreateAccessTokenRequest = z.input<typeof createAccessTokenRequestSchema>;
export type CreateAccessTokenResponse = z.infer<typeof createAccessTokenResponseSchema>;
