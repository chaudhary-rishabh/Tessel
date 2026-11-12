import {
  createLiveModelRegistry,
  createRagPipeline,
  readModelsConfig,
  type Ai,
  type LiveModelRegistry,
  type VectorIndex,
} from "@tessel/ai";
import type { Database } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import type { ObjectStore, UploadEventQueue } from "@tessel/storage";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { GraphStore } from "@tessel/graph";
import { createMemoryStore, type EpisodeIndex } from "@tessel/memory";
import type { IdentityProvider } from "@tessel/contracts";
import type { Mailer, OutboxMailer } from "./lib/mailer";
import type { OutboxSms, SmsSender } from "./lib/sms";
import express, { type Express } from "express";
import helmet from "helmet";
import type { AppConfig } from "./config";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { createRateLimiter, type RateLimitStoreFactory } from "./middleware/rate-limit";
import { requestId } from "./middleware/request-id";
import { requestLogger } from "./middleware/request-logger";
import { requireAuth } from "./middleware/require-auth";
import { createAiController } from "./modules/ai/ai.controller";
import { createCompletionsRouter, createModelsRouter } from "./modules/ai/ai.routes";
import { createAiService } from "./modules/ai/ai.service";
import { createAuthController } from "./modules/auth/auth.controller";
import { createAuthRouter } from "./modules/auth/auth.routes";
import { createAuthService } from "./modules/auth/auth.service";
import { createRefreshCookie } from "./modules/auth/cookies";
import { createPasswordHasher, type PasswordHasher } from "./modules/auth/password";
import { createSessionTokens } from "./modules/auth/tokens";
import type { DependencyCheckFn } from "./modules/health/checks";
import { createChatController } from "./modules/chat/chat.controller";
import { createChatRouter } from "./modules/chat/chat.routes";
import { createChatService } from "./modules/chat/chat.service";
import { createDocumentsController } from "./modules/documents/documents.controller";
import { createDocumentsRouter } from "./modules/documents/documents.routes";
import {
  createConnectorCallbackRouter,
  createConnectorsRouter,
} from "./modules/connectors/connectors.routes";
import {
  createConnectorsService,
  type ConnectorsSettings,
} from "./modules/connectors/connectors.service";
import {
  createAccessTokensRouter,
  createCurrentTokenRouter,
} from "./modules/access-tokens/access-tokens.routes";
import { createAccessTokensService } from "./modules/access-tokens/access-tokens.service";
import { createMemoryRouter } from "./modules/memory/memory.routes";
import { createMemoryService, type MemoryQueue } from "./modules/memory/memory.service";
import { createGraphRouter } from "./modules/graph/graph.routes";
import { createGraphService } from "./modules/graph/graph.service";
import { createTwoFactorService } from "./modules/auth/two-factor.service";
import { createPhoneService } from "./modules/auth/phone.service";
import { createSignInMethodsRouter, createSignInRouter } from "./modules/auth/sign-in.routes";
import type { SocialProvider } from "./modules/auth/social-providers";
import { createSocialService } from "./modules/auth/social.service";
import {
  createConnectedAppsRouter,
  createOAuthConsentRouter,
  createOAuthServerRouter,
} from "./modules/oauth/oauth.routes";
import { createOAuthService } from "./modules/oauth/oauth.service";
import { createAuditRecorder } from "./lib/audit";
import { createInvitationLinksRouter, createMembersRouter } from "./modules/members/members.routes";
import { createMembersService } from "./modules/members/members.service";
import { createAdminRouter } from "./modules/admin/admin.routes";
import { createAdminService } from "./modules/admin/admin.service";
import { createBillingRouter, createBillingWebhookRouter } from "./modules/billing/billing.routes";
import type { PaymentProvider } from "./modules/billing/providers";
import { createBillingService } from "./modules/billing/billing.service";
import { createUsageLimits } from "./modules/billing/usage-limits";
import { createSkillsRouter } from "./modules/skills/skills.routes";
import { createSkillsService } from "./modules/skills/skills.service";
import { createDocumentsService } from "./modules/documents/documents.service";
import { createHealthRouter } from "./modules/health/health.routes";
import { createUsageController } from "./modules/usage/usage.controller";
import { createUsageRouter } from "./modules/usage/usage.routes";
import { createUsageService } from "./modules/usage/usage.service";
import { createUsersController } from "./modules/users/users.controller";
import { createUsersRouter } from "./modules/users/users.routes";
import { createUsersService } from "./modules/users/users.service";
import { createWorkspacesController } from "./modules/workspaces/workspaces.controller";
import { createWorkspacesRouter } from "./modules/workspaces/workspaces.routes";
import { createWorkspacesService } from "./modules/workspaces/workspaces.service";

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  db: Database;
  /** Every model call goes through this: spend caps, moderation, usage ledger. */
  ai: Ai;
  /** Stripe and Razorpay, for paid plans. Each is off when missing. */
  payments?: Partial<Record<"stripe" | "razorpay", PaymentProvider>>;
  /** The registry `ai` uses, when it can be edited live (the admin app's model settings). */
  models?: LiveModelRegistry;
  /** S3 for files, SQS for upload events. */
  storage: { objects: ObjectStore; uploads: UploadEventQueue; uploadEvents: "s3" | "api" };
  /** Qdrant: document chunks for search. */
  vectorIndex: VectorIndex;
  readinessChecks: DependencyCheckFn[];
  /** The knowledge graph (Neo4j), for graph RAG. Optional: without it, answers use search only. */
  graph?: GraphStore | undefined;
  /** Episodic memory (past chats) and the queue for memory work after replies. */
  memory: { episodes: EpisodeIndex; queue: MemoryQueue };
  /** Sends account emails: signup codes, password resets, security notices. */
  mailer: Mailer;
  /** Other ways to sign in. Each is off when its part is missing. */
  signIn?: {
    /** Where browsers reach the API, for the Google and GitHub callbacks. */
    apiPublicUrl: string;
    providers?: Partial<Record<IdentityProvider, SocialProvider>>;
    /** Texts sign-in codes; without it, phone sign-in is off. */
    sms?: SmsSender | undefined;
    /**
     * Tessel's MCP server as clients reach it (e.g. https://mcp.example.com/mcp).
     * With it, the API is also the OAuth server MCP clients sign in through.
     */
    mcpResourceUrl?: string | undefined;
  };
  /** MCP connectors: the catalog, credential encryption, and OAuth redirects. */
  connectors: ConnectorsSettings;
  /** Rate limit storage per limiter. Defaults to in-memory (single instance only). */
  rateLimitStoreFactory?: RateLimitStoreFactory;
  /** Override for tests, which use cheaper hashing settings. */
  passwordHasher?: PasswordHasher;
}

const DAY_MS = 86_400_000;

export function createApp({
  config,
  logger,
  db,
  ai,
  storage,
  vectorIndex,
  readinessChecks,
  connectors,
  memory,
  graph,
  mailer,
  models = createLiveModelRegistry(readModelsConfig()),
  payments = {},
  signIn = { apiPublicUrl: "http://localhost:4000" },
  rateLimitStoreFactory,
  passwordHasher = createPasswordHasher(),
}: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  // Request pipeline, in order: ID, logging, security headers, CORS, body parsing.
  app.use(requestId);
  app.use(requestLogger(logger));
  app.use(helmet());

  const audit = createAuditRecorder({ db, logger });
  const usageLimits = config.enforcePlanLimits ? createUsageLimits({ db }) : undefined;
  const billingService = createBillingService({
    db,
    limits: usageLimits ?? createUsageLimits({ db }),
    audit,
    logger,
    payments,
    webOrigin: config.corsOrigins[0]!,
  });
  // Payment providers post here; they need the raw body, so this comes before JSON parsing.
  app.use("/billing/webhooks", createBillingWebhookRouter({ service: billingService }));

  // MCP clients sign in through these from any origin, so they come before CORS.
  const accessTokensService = createAccessTokensService({ db, audit });
  const oauthService = createOAuthService({
    db,
    logger,
    box: connectors.box,
    accessTokens: accessTokensService,
    webOrigin: config.corsOrigins[0]!,
    resourceUrl: signIn.mcpResourceUrl ?? "http://localhost:4100/mcp",
    audit,
  });
  if (signIn.mcpResourceUrl) {
    app.use(
      createOAuthServerRouter({
        service: oauthService,
        issuerUrl: signIn.apiPublicUrl,
        resourceUrl: signIn.mcpResourceUrl,
      }),
    );
  }

  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      exposedHeaders: ["x-request-id", "ratelimit", "ratelimit-policy", "retry-after"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Health checks stay outside rate limiting so probes never get throttled.
  app.use(
    createHealthRouter({
      service: config.service,
      readinessChecks,
      exposeCheckErrors: !config.isProduction,
    }),
  );
  app.use(
    createRateLimiter({
      name: "api",
      ...config.rateLimits.api,
      storeFactory: rateLimitStoreFactory,
    }),
  );

  // Services
  const sessionTokens = createSessionTokens({
    secret: config.auth.accessTokenSecret,
    ttlSeconds: config.auth.accessTokenTtlSeconds,
  });
  const refreshTokenTtlMs = config.auth.refreshTokenTtlDays * DAY_MS;
  const refreshCookie = createRefreshCookie({
    secure: config.auth.cookieSecure,
    maxAgeMs: refreshTokenTtlMs,
  });
  const authService = createAuthService({
    db,
    logger,
    passwords: passwordHasher,
    sessionTokens,
    refreshTokenTtlMs,
    refreshRotationGraceMs: config.auth.refreshRotationGraceMs,
    mailer,
    webOrigin: config.corsOrigins[0]!,
    box: connectors.box,
    audit,
  });
  const twoFactorService = createTwoFactorService({
    audit,
    db,
    box: connectors.box,
    passwords: passwordHasher,
    mailer,
    logger,
  });
  const socialService = createSocialService({
    db,
    logger,
    box: connectors.box,
    mailer,
    providers: signIn.providers ?? {},
    callbackUrl: (provider) =>
      new URL(`/auth/oauth/${provider}/callback`, signIn.apiPublicUrl).toString(),
    webOrigin: config.corsOrigins[0]!,
    beginSession: authService.beginSession,
    audit,
  });
  const phoneService = createPhoneService({
    db,
    logger,
    sms: signIn.sms,
    mailer,
    beginSession: authService.beginSession,
    audit,
  });
  const usersService = createUsersService({ db });
  const workspacesService = createWorkspacesService({
    db,
    audit,
    logger,
    billing: billingService,
    purge: async ({ workspaceId, documentIds }) => {
      // Search and graph entries can't be reached once the workspace is gone, so a
      // failure there is logged; the files are the user's data and must go.
      const bestEffort = (what: string, work: () => Promise<unknown>) =>
        work().catch((error: unknown) =>
          logger.warn(
            { err: error, workspaceId },
            `Couldn't remove ${what} of a deleted workspace`,
          ),
        );
      for (const documentId of documentIds) {
        await bestEffort("search index entries", () =>
          vectorIndex.deleteDocument(workspaceId, documentId),
        );
        if (graph) {
          await bestEffort("graph data", () => graph.deleteDocument(workspaceId, documentId));
        }
      }
      await bestEffort("chat search entries", () => memory.episodes.removeWorkspace(workspaceId));
      await storage.objects.deletePrefix(`workspaces/${workspaceId}/`);
    },
  });
  const aiController = createAiController(createAiService({ db, ai, limits: usageLimits }));
  const usageController = createUsageController(
    createUsageService({ db, spend: ai.spend, registry: ai.registry }),
  );
  const graphService = createGraphService({ db, graph });
  const documentsService = createDocumentsService({
    audit,
    graph: graphService,
    db,
    ai,
    objects: storage.objects,
    uploads: storage.uploads,
    uploadEvents: storage.uploadEvents,
    index: vectorIndex,
    logger,
  });
  const documentsController = createDocumentsController(documentsService);
  const skillsService = createSkillsService({ db, ai });
  const connectorsService = createConnectorsService({
    db,
    logger,
    settings: connectors,
    audit,
  });
  const memoryStore = createMemoryStore(db);
  const memoryService = createMemoryService({
    db,
    ai,
    logger,
    memory: { store: memoryStore, ...memory },
  });
  const chatController = createChatController({
    documents: documentsService,
    skills: skillsService,
    connectors: connectorsService,
    memory: memoryService,
    service: createChatService({
      db,
      ai,
      logger,
      objects: storage.objects,
      memory: memoryStore,
      limits: usageLimits,
    }),
    ai,
    graph: graphService,
    rag: createRagPipeline({
      ai,
      index: vectorIndex,
      logger,
      ...(graphService.enabled ? { graph: graphService.lookup } : {}),
    }),
    logger,
  });
  const authenticate = requireAuth(sessionTokens, accessTokensService.resolve);

  // Feature modules
  app.use(
    "/auth",
    createSignInRouter({
      social: socialService,
      phone: phoneService,
      refreshCookie,
      authenticate,
      cookieSecure: config.auth.cookieSecure,
      rateLimits: config.rateLimits,
      storeFactory: rateLimitStoreFactory,
      allowedOrigins: config.corsOrigins,
    }),
  );
  app.use(
    "/users/me",
    createSignInMethodsRouter({
      social: socialService,
      phone: phoneService,
      authenticate,
      rateLimits: config.rateLimits,
      storeFactory: rateLimitStoreFactory,
    }),
  );
  app.use(
    "/auth",
    createAuthRouter({
      controller: createAuthController(authService, refreshCookie),
      rateLimits: config.rateLimits,
      storeFactory: rateLimitStoreFactory,
      allowedOrigins: config.corsOrigins,
      authenticate,
    }),
  );
  app.use(
    "/users",
    createUsersRouter({
      controller: createUsersController(usersService, authService, refreshCookie, twoFactorService),
      authenticate,
      passwordRateLimit: config.rateLimits.password,
      emailRateLimit: config.rateLimits.signup,
      storeFactory: rateLimitStoreFactory,
    }),
  );
  app.use(
    "/workspaces",
    createWorkspacesRouter({
      controller: createWorkspacesController(workspacesService),
      authenticate,
    }),
  );
  const membersService = createMembersService({
    db,
    logger,
    mailer,
    audit,
    onMembershipChange: (workspaceId) => billingService.syncSeats(workspaceId),
    webOrigin: config.corsOrigins[0]!,
  });
  app.use(
    "/workspaces/:workspaceId",
    createMembersRouter({
      service: membersService,
      authenticate,
      inviteRateLimit: config.rateLimits.signup,
      storeFactory: rateLimitStoreFactory,
    }),
  );
  app.use(
    "/workspaces/:workspaceId/billing",
    createBillingRouter({ service: billingService, authenticate }),
  );
  app.use("/invitations", createInvitationLinksRouter({ service: membersService, authenticate }));
  app.use(
    "/admin",
    createAdminRouter({
      service: createAdminService({ db, logger, audit, models }),
      authenticate,
      db,
      requireTwoFactor: config.adminRequireTwoFactor,
    }),
  );
  app.use(
    "/workspaces/:workspaceId/completions",
    createCompletionsRouter({
      controller: aiController,
      authenticate,
      rateLimit: config.rateLimits.ai,
      storeFactory: rateLimitStoreFactory,
    }),
  );
  app.use(
    "/workspaces/:workspaceId/usage",
    createUsageRouter({ controller: usageController, authenticate }),
  );
  app.use(
    "/workspaces/:workspaceId",
    createChatRouter({
      controller: chatController,
      authenticate,
      rateLimit: config.rateLimits.ai,
      storeFactory: rateLimitStoreFactory,
    }),
  );
  app.use(
    "/workspaces/:workspaceId",
    createDocumentsRouter({
      controller: documentsController,
      authenticate,
      rateLimit: config.rateLimits.ai,
      storeFactory: rateLimitStoreFactory,
    }),
  );
  app.use(
    "/workspaces/:workspaceId/skills",
    createSkillsRouter({ service: skillsService, authenticate }),
  );
  app.use(
    "/workspaces/:workspaceId/connectors",
    createConnectorsRouter({
      service: connectorsService,
      authenticate,
      cookieSecure: config.auth.cookieSecure,
    }),
  );
  app.use(
    "/workspaces/:workspaceId/graph",
    createGraphRouter({ service: graphService, authenticate }),
  );
  app.use(
    "/workspaces/:workspaceId/memory",
    createMemoryRouter({ service: memoryService, authenticate }),
  );
  app.use(
    "/workspaces/:workspaceId/access-tokens",
    createAccessTokensRouter({ service: accessTokensService, authenticate }),
  );
  app.use("/access-tokens", createCurrentTokenRouter({ db, authenticate }));
  app.use(
    "/oauth/authorizations",
    createOAuthConsentRouter({ service: oauthService, authenticate }),
  );
  app.use(
    "/users/me/connected-apps",
    createConnectedAppsRouter({ service: oauthService, authenticate }),
  );
  app.use(
    "/connectors",
    createConnectorCallbackRouter({
      service: connectorsService,
      cookieSecure: config.auth.cookieSecure,
    }),
  );
  // Development only: read the emails and texts the outboxes kept (codes, reset links).
  if (!config.isProduction) {
    const emailOutbox = "messages" in mailer ? (mailer as OutboxMailer) : undefined;
    const smsOutbox =
      signIn.sms && "messages" in signIn.sms ? (signIn.sms as OutboxSms) : undefined;
    app.get("/dev/outbox", (req, res) => {
      const to = typeof req.query.to === "string" ? req.query.to.toLowerCase() : undefined;
      const matches = (message: { to: string }) => !to || message.to.toLowerCase() === to;
      res.json({
        messages: (emailOutbox?.messages ?? []).filter(matches).slice(-20),
        texts: (smsOutbox?.messages ?? []).filter(matches).slice(-20),
      });
    });
  }
  app.use("/models", createModelsRouter({ controller: aiController, authenticate }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
