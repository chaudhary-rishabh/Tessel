import { randomBytes } from "node:crypto";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { ACCESS_TOKEN_SCOPES, type ConnectedApp, type OAuthAuthorization } from "@tessel/contracts";
import {
  oauthAuthorizations,
  oauthClients,
  oauthGrants,
  personalAccessTokens,
  withUserContext,
  workspaces,
  type Database,
  type OAuthGrantRow,
} from "@tessel/db";
import type { Logger } from "@tessel/logger";
import type { SecretBox } from "@tessel/mcp";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Response } from "express";
import { errors } from "../../lib/errors";
import {
  OAUTH_TOKEN_PREFIX,
  type AccessTokensService,
} from "../access-tokens/access-tokens.service";
import { hashToken } from "../auth/tokens";
import { workspacesRepository } from "../workspaces/workspaces.repository";

const AUTHORIZATION_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TOKEN_TTL_SECONDS = 3600;
/** What a client may ask for; today the same read-only access as a personal token. */
const SUPPORTED_SCOPES: readonly string[] = ACCESS_TOKEN_SCOPES;

const random = (bytes: number) => randomBytes(bytes).toString("base64url");

export interface OAuthServiceDependencies {
  db: Database;
  logger: Logger;
  box: SecretBox;
  accessTokens: AccessTokensService;
  /** Where the consent page lives: WEB/oauth/consent/:id. */
  webOrigin: string;
  /** Tessel's MCP server, the one resource these tokens are for. */
  resourceUrl: string;
  now?: () => Date;
}

/**
 * Tessel's OAuth 2.1 authorization server for outside MCP clients, plugged
 * into the MCP SDK's router (registration, authorize, token, revoke,
 * metadata). The user approves on the web app's consent page; the client
 * gets hour-long access tokens for one workspace, plus a rotating refresh
 * token. Access tokens are stored like personal access tokens, so the API
 * checks them the same way.
 */
export function createOAuthService({
  db,
  logger,
  box,
  accessTokens,
  webOrigin,
  resourceUrl,
  now = () => new Date(),
}: OAuthServiceDependencies) {
  const clientsStore: OAuthRegisteredClientsStore = {
    async getClient(clientId) {
      const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
      return row ? box.open<OAuthClientInformationFull>(row.sealedInfo) : undefined;
    },
    async registerClient(client) {
      const info = client as OAuthClientInformationFull;
      await db.insert(oauthClients).values({
        id: info.client_id,
        name: (info.client_name ?? "An MCP client").slice(0, 100),
        sealedInfo: box.seal(info),
      });
      logger.info({ clientId: info.client_id }, "OAuth client registered");
      return info;
    },
  };

  /** Only Tessel's MCP server; a client asking for anything else gets nothing. */
  function checkResource(resource: URL | undefined) {
    if (resource && resource.href.replace(/\/$/, "") !== resourceUrl.replace(/\/$/, "")) {
      throw new InvalidTargetError(`This server only issues tokens for ${resourceUrl}`);
    }
  }

  /** A fresh hour-long access token for a grant, stored as the grant user's token. */
  async function issueTokens(grant: OAuthGrantRow, refreshToken: string): Promise<OAuthTokens> {
    const accessToken = `${OAUTH_TOKEN_PREFIX}${random(24)}`;
    const [client] = await db
      .select({ name: oauthClients.name })
      .from(oauthClients)
      .where(eq(oauthClients.id, grant.clientId));
    await withUserContext(db, grant.userId, (tx) =>
      tx.insert(personalAccessTokens).values({
        userId: grant.userId,
        workspaceId: grant.workspaceId,
        grantId: grant.id,
        name: client?.name ?? "MCP client",
        tokenHash: hashToken(accessToken),
        prefix: accessToken.slice(0, OAUTH_TOKEN_PREFIX.length + 4),
        scopes: grant.scopes,
        expiresAt: new Date(now().getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
      }),
    );
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: grant.scopes.join(" "),
    };
  }

  /** Ends a grant and every access token it issued. */
  async function revokeGrant(grant: Pick<OAuthGrantRow, "id" | "userId">) {
    await db.update(oauthGrants).set({ revokedAt: now() }).where(eq(oauthGrants.id, grant.id));
    await withUserContext(db, grant.userId, (tx) =>
      tx
        .update(personalAccessTokens)
        .set({ revokedAt: now() })
        .where(
          and(eq(personalAccessTokens.grantId, grant.id), isNull(personalAccessTokens.revokedAt)),
        ),
    );
  }

  const provider: OAuthServerProvider = {
    get clientsStore() {
      return clientsStore;
    },

    /** Saves the request and sends the browser to the consent page. */
    async authorize(client, params: AuthorizationParams, res: Response) {
      checkResource(params.resource);
      const scopes = params.scopes?.length
        ? params.scopes.filter((scope) => SUPPORTED_SCOPES.includes(scope))
        : [...SUPPORTED_SCOPES];
      const [row] = await db
        .insert(oauthAuthorizations)
        .values({
          clientId: client.client_id,
          redirectUri: params.redirectUri,
          codeChallenge: params.codeChallenge,
          state: params.state ?? null,
          scopes: scopes.length > 0 ? scopes : [...SUPPORTED_SCOPES],
          resource: params.resource?.href ?? null,
          expiresAt: new Date(now().getTime() + AUTHORIZATION_TTL_MS),
        })
        .returning({ id: oauthAuthorizations.id });
      res.redirect(302, `${webOrigin}/oauth/consent/${row!.id}`);
    },

    async challengeForAuthorizationCode(client, code) {
      const [row] = await db
        .select({ codeChallenge: oauthAuthorizations.codeChallenge })
        .from(oauthAuthorizations)
        .where(
          and(
            eq(oauthAuthorizations.codeHash, hashToken(code)),
            eq(oauthAuthorizations.clientId, client.client_id),
            eq(oauthAuthorizations.status, "approved"),
            gt(oauthAuthorizations.expiresAt, now()),
          ),
        );
      if (!row) throw new InvalidGrantError("Invalid or expired authorization code");
      return row.codeChallenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
      checkResource(resource);
      // Used once: only one request can move it from approved to used.
      const [used] = await db
        .update(oauthAuthorizations)
        .set({ status: "used" })
        .where(
          and(
            eq(oauthAuthorizations.codeHash, hashToken(code)),
            eq(oauthAuthorizations.clientId, client.client_id),
            eq(oauthAuthorizations.status, "approved"),
            gt(oauthAuthorizations.expiresAt, now()),
          ),
        )
        .returning();
      if (!used?.userId || !used.workspaceId) {
        throw new InvalidGrantError("Invalid or expired authorization code");
      }
      if (redirectUri !== undefined && redirectUri !== used.redirectUri) {
        throw new InvalidGrantError("redirect_uri doesn't match the authorization request");
      }
      const refreshToken = random(32);
      const [grant] = await db
        .insert(oauthGrants)
        .values({
          clientId: client.client_id,
          userId: used.userId,
          workspaceId: used.workspaceId,
          scopes: used.scopes,
          refreshTokenHash: hashToken(refreshToken),
        })
        .returning();
      logger.info({ userId: used.userId, clientId: client.client_id }, "MCP client connected");
      return issueTokens(grant!, refreshToken);
    },

    /** Rotates the refresh token. Presenting a replaced one means it was copied: the grant ends. */
    async exchangeRefreshToken(client, refreshToken, scopes, resource) {
      checkResource(resource);
      const presented = hashToken(refreshToken);
      const next = random(32);
      const [grant] = await db
        .update(oauthGrants)
        .set({
          refreshTokenHash: hashToken(next),
          previousRefreshTokenHash: presented,
          lastUsedAt: now(),
        })
        .where(
          and(
            eq(oauthGrants.refreshTokenHash, presented),
            eq(oauthGrants.clientId, client.client_id),
            isNull(oauthGrants.revokedAt),
          ),
        )
        .returning();
      if (!grant) {
        const [reused] = await db
          .select()
          .from(oauthGrants)
          .where(
            and(
              eq(oauthGrants.previousRefreshTokenHash, presented),
              eq(oauthGrants.clientId, client.client_id),
              isNull(oauthGrants.revokedAt),
            ),
          );
        if (reused) {
          logger.warn({ grantId: reused.id }, "Old MCP refresh token reused; revoking the grant");
          await revokeGrant(reused);
        }
        throw new InvalidGrantError("Invalid refresh token");
      }
      if (scopes?.some((scope) => !grant.scopes.includes(scope))) {
        throw new InvalidGrantError("A refresh can't add scopes");
      }
      return issueTokens(grant, next);
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const identity = await accessTokens.resolve(token);
      if (!identity) throw new InvalidTokenError("Invalid, expired, or revoked token");
      return {
        token,
        clientId: identity.tokenId,
        scopes: identity.scopes,
        extra: { userId: identity.userId, workspaceId: identity.workspaceId },
      };
    },

    async revokeToken(client, request: OAuthTokenRevocationRequest) {
      const hashed = hashToken(request.token);
      const [byRefresh] = await db
        .select()
        .from(oauthGrants)
        .where(
          and(eq(oauthGrants.refreshTokenHash, hashed), eq(oauthGrants.clientId, client.client_id)),
        );
      if (byRefresh) return revokeGrant(byRefresh);
      // An access token: end its grant too, as the client is disconnecting.
      const identity = await accessTokens.resolve(request.token);
      if (!identity) return;
      const [grant] = await db
        .select()
        .from(oauthGrants)
        .innerJoin(personalAccessTokens, eq(personalAccessTokens.grantId, oauthGrants.id))
        .where(
          and(
            eq(personalAccessTokens.id, identity.tokenId),
            eq(oauthGrants.clientId, client.client_id),
          ),
        );
      if (grant) await revokeGrant(grant.oauth_grants);
    },
  };

  async function pending(authorizationId: string) {
    const [row] = await db
      .select({
        authorization: oauthAuthorizations,
        clientName: oauthClients.name,
        info: oauthClients.sealedInfo,
      })
      .from(oauthAuthorizations)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthAuthorizations.clientId))
      .where(
        and(
          eq(oauthAuthorizations.id, authorizationId),
          eq(oauthAuthorizations.status, "pending"),
          gt(oauthAuthorizations.expiresAt, now()),
        ),
      );
    if (!row) {
      throw errors.notFound("This sign-in request has expired. Start again from the app.");
    }
    return row;
  }

  function redirectWith(redirectUri: string, params: Record<string, string | null>) {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
      if (value !== null) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  return {
    provider,

    /** What the consent page shows. */
    async describe(authorizationId: string): Promise<OAuthAuthorization> {
      const { authorization, clientName, info } = await pending(authorizationId);
      const client = box.open<OAuthClientInformationFull>(info);
      return {
        id: authorization.id,
        client: { name: clientName, uri: client.client_uri ?? null },
        redirectHost: new URL(authorization.redirectUri).host,
        scopes: authorization.scopes,
        expiresAt: authorization.expiresAt.toISOString(),
      };
    },

    /** The user allows the client into a workspace they belong to; returns where to send the browser. */
    async approve(userId: string, authorizationId: string, workspaceId: string): Promise<string> {
      const { authorization } = await pending(authorizationId);
      const member = await withUserContext(db, userId, (tx) =>
        workspacesRepository.findForUser(tx, workspaceId, userId),
      );
      if (!member) throw errors.notFound("Workspace not found");
      const code = random(32);
      const [approved] = await db
        .update(oauthAuthorizations)
        .set({
          status: "approved",
          userId,
          workspaceId,
          codeHash: hashToken(code),
          expiresAt: new Date(now().getTime() + CODE_TTL_MS),
        })
        .where(
          and(
            eq(oauthAuthorizations.id, authorization.id),
            eq(oauthAuthorizations.status, "pending"),
          ),
        )
        .returning({ id: oauthAuthorizations.id });
      if (!approved)
        throw errors.notFound("This sign-in request has expired. Start again from the app.");
      return redirectWith(authorization.redirectUri, { code, state: authorization.state });
    },

    async deny(authorizationId: string): Promise<string> {
      const { authorization } = await pending(authorizationId);
      await db
        .update(oauthAuthorizations)
        .set({ status: "denied" })
        .where(eq(oauthAuthorizations.id, authorization.id));
      return redirectWith(authorization.redirectUri, {
        error: "access_denied",
        error_description: "The user declined",
        state: authorization.state,
      });
    },

    async listApps(userId: string): Promise<ConnectedApp[]> {
      // As the user: workspace names are behind row-level security.
      const rows = await withUserContext(db, userId, (tx) =>
        tx
          .select({
            grant: oauthGrants,
            name: oauthClients.name,
            workspaceName: workspaces.name,
          })
          .from(oauthGrants)
          .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
          .innerJoin(workspaces, eq(workspaces.id, oauthGrants.workspaceId))
          .where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)))
          .orderBy(desc(oauthGrants.createdAt)),
      );
      return rows.map(({ grant, name, workspaceName }) => ({
        id: grant.id,
        name,
        workspace: { id: grant.workspaceId, name: workspaceName },
        scopes: grant.scopes,
        createdAt: grant.createdAt.toISOString(),
        lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
      }));
    },

    async disconnect(userId: string, grantId: string): Promise<void> {
      const [grant] = await db
        .select()
        .from(oauthGrants)
        .where(
          and(
            eq(oauthGrants.id, grantId),
            eq(oauthGrants.userId, userId),
            isNull(oauthGrants.revokedAt),
          ),
        );
      if (!grant) throw errors.notFound("App not found");
      await revokeGrant(grant);
    },
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
