import { createRagPipeline, type Ai, type VectorIndex } from "@tessel/ai";
import type { Database } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import type { ObjectStore, UploadEventQueue } from "@tessel/storage";
import cookieParser from "cookie-parser";
import cors from "cors";
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
import { createAccessTokens } from "./modules/auth/tokens";
import type { DependencyCheckFn } from "./modules/health/checks";
import { createChatController } from "./modules/chat/chat.controller";
import { createChatRouter } from "./modules/chat/chat.routes";
import { createChatService } from "./modules/chat/chat.service";
import { createDocumentsController } from "./modules/documents/documents.controller";
import { createDocumentsRouter } from "./modules/documents/documents.routes";
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
  /** S3 for files, SQS for upload events. */
  storage: { objects: ObjectStore; uploads: UploadEventQueue; uploadEvents: "s3" | "api" };
  /** Qdrant: document chunks for search. */
  vectorIndex: VectorIndex;
  readinessChecks: DependencyCheckFn[];
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
  const accessTokens = createAccessTokens({
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
    accessTokens,
    refreshTokenTtlMs,
    refreshRotationGraceMs: config.auth.refreshRotationGraceMs,
  });
  const usersService = createUsersService({ db });
  const workspacesService = createWorkspacesService({ db });
  const aiController = createAiController(createAiService({ db, ai }));
  const usageController = createUsageController(
    createUsageService({ db, spend: ai.spend, registry: ai.registry }),
  );
  const chatController = createChatController({
    service: createChatService({ db, ai, logger, objects: storage.objects }),
    ai,
    rag: createRagPipeline({ ai, index: vectorIndex, logger }),
    logger,
  });
  const documentsController = createDocumentsController(
    createDocumentsService({
      db,
      ai,
      objects: storage.objects,
      uploads: storage.uploads,
      uploadEvents: storage.uploadEvents,
      index: vectorIndex,
      logger,
    }),
  );
  const authenticate = requireAuth(accessTokens);

  // Feature modules
  app.use(
    "/auth",
    createAuthRouter({
      controller: createAuthController(authService, refreshCookie),
      rateLimits: config.rateLimits,
      storeFactory: rateLimitStoreFactory,
      allowedOrigins: config.corsOrigins,
    }),
  );
  app.use(
    "/users",
    createUsersRouter({
      controller: createUsersController(usersService, authService, refreshCookie),
      authenticate,
      passwordRateLimit: config.rateLimits.password,
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
  app.use("/models", createModelsRouter({ controller: aiController, authenticate }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
