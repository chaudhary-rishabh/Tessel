import {
  aiOptionsFromEnv,
  createAi,
  createLiveModelRegistry,
  readModelsConfig,
  syncLiveRegistry,
  createQdrantIndex,
  redisKeyValueCache,
  withSearchCache,
  createSpendGuard,
  redisSpendStore,
  spendLimitsFromEnv,
} from "@tessel/ai";
import { loadEnvFiles, parseEnv } from "@tessel/config/env";
import { createDatabase, createUsageLedger, loadModelConfig, pingDatabase } from "@tessel/db";
import { createSecretBox } from "@tessel/mcp";
import { graphStoreFromEnv } from "@tessel/graph";
import { createQdrantEpisodeIndex } from "@tessel/memory";
import { createMemoryQueue, createQueueConnection } from "@tessel/queue";
import { createS3ObjectStore, createSqsUploadQueue } from "@tessel/storage";
import { createLogger } from "@tessel/logger";
import { RedisStore } from "rate-limit-redis";
import { createApp } from "./app";
import { createLiveKitRooms } from "./modules/voice/livekit";
import { createElevenLabs } from "./modules/voice/elevenlabs";
import {
  createGateway,
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribeAudio,
} from "ai";
import { createOutboxMailer, createSesMailer } from "./lib/mailer";
import { createOutboxSms, createSnsSms } from "./lib/sms";
import { createSocialProviders } from "./modules/auth/social-providers";
import { createRazorpayProvider, createStripeProvider } from "./modules/billing/providers";
import { connectorCatalog } from "./modules/connectors/connectors.catalog";
import { configFromEnv } from "./config";
import { envSchema } from "./env";
import { createCheck, httpProbe } from "./modules/health/checks";
import { createRedisClient } from "./redis";

const SHUTDOWN_TIMEOUT_MS = 10_000;

loadEnvFiles();
const env = parseEnv(envSchema);
// These default to localhost for development. Unset in production, sign-in and
// connector redirects would quietly point at localhost, so refuse to start.
if (env.NODE_ENV === "production") {
  const missing = ["WEB_ORIGIN", "API_PUBLIC_URL"].filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Set ${missing.join(" and ")} to the public addresses before starting`);
  }
}
const config = configFromEnv(env);
const logger = createLogger(config.service);

const database = createDatabase({ url: env.DATABASE_URL });
const redisCache = createRedisClient(env.REDIS_CACHE_URL, "redis-cache", logger);
const redisQueue = createRedisClient(env.REDIS_QUEUE_URL, "redis-queue", logger);
// Rate limiting fails open: if Redis is slow or down, requests go through
// after a short timeout instead of failing.
const rateLimitRedis = createRedisClient(env.REDIS_CACHE_URL, "rate-limit", logger, {
  offlineQueue: true,
  commandTimeoutMs: 250,
});

// Spend counters live in the cache Redis; the Postgres ledger is the source
// of truth and is read instead whenever Redis is unavailable.
const ledger = createUsageLedger(database.db);
const spend = createSpendGuard({
  store: redisSpendStore(redisCache),
  limits: spendLimitsFromEnv(env),
  logger,
  ledgerFallback: ledger.spentSince,
});
// Embeddings and search results are cached in the cache Redis (failing open).
const cache = redisKeyValueCache(redisCache, { prefix: "tessel:" });
// Models come from the admin app's saved registry when there is one, else models.json.
const registry = createLiveModelRegistry(readModelsConfig(env.AI_MODELS_FILE));
await syncLiveRegistry({
  registry,
  load: () => loadModelConfig(database.db),
  onError: (error) => logger.error({ err: error }, "Couldn't load the saved model registry"),
});
const ai = createAi(aiOptionsFromEnv(env, { spend, ledger, logger, cache, registry }));
if (!ai.isConfigured) {
  logger.warn("AI is off: set AI_GATEWAY_API_KEY (or a fallback provider key) to turn it on");
}

const objects = createS3ObjectStore(env);
const uploads = createSqsUploadQueue(env);
const vectorIndex = withSearchCache(
  createQdrantIndex({
    url: env.QDRANT_URL,
    collection: env.QDRANT_COLLECTION,
    dimensions: ai.registry.forRole("embedding").dimensions ?? 1536,
    ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
  }),
  cache,
);

const episodes = createQdrantEpisodeIndex({
  url: env.QDRANT_URL,
  collection: env.QDRANT_EPISODES_COLLECTION,
  dimensions: ai.registry.forRole("embedding").dimensions ?? 1536,
  ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
});
const graph = graphStoreFromEnv(env);
await graph
  ?.ensureSchema()
  .catch((error: unknown) => logger.error({ err: error }, "Could not prepare the knowledge graph"));
const memoryQueue = createMemoryQueue(createQueueConnection(env.REDIS_QUEUE_URL));

// Emulators start empty: create the bucket, its CORS rules, and the queue.
// In AWS these are created once by the setup steps in infra/aws/README.md.
if (env.STORAGE_AUTO_CREATE) {
  await Promise.all([objects.ensureBucket(env.WEB_ORIGIN), uploads.ensureQueue()]).catch(
    (error: unknown) =>
      logger.error({ err: error }, "Could not create the storage bucket or upload queue"),
  );
}
await Promise.all([vectorIndex.ensureCollection(), episodes.ensureCollection()]).catch(
  (error: unknown) => logger.error({ err: error }, "Could not prepare the search indexes"),
);

/** Phone sign-in: SNS in production when turned on, an outbox in development. */
function smsFromEnv() {
  const transport = env.SMS_TRANSPORT ?? (config.isProduction ? "off" : "outbox");
  if (transport === "off") return undefined;
  if (transport === "outbox") return createOutboxSms({ logger });
  return createSnsSms({
    region: env.AWS_REGION,
    senderId: env.SMS_SENDER_ID,
    dltEntityId: env.SMS_DLT_ENTITY_ID,
    dltTemplateId: env.SMS_DLT_TEMPLATE_ID,
  });
}

/** Stripe and Razorpay, each on when its keys are set. */
function paymentsFromEnv() {
  const mock = env.PAYMENTS_MOCK_URL?.replace(/\/$/, "");
  return {
    ...(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
      ? {
          stripe: createStripeProvider({
            secretKey: env.STRIPE_SECRET_KEY,
            webhookSecret: env.STRIPE_WEBHOOK_SECRET,
            prices: {
              pro: env.STRIPE_PRICE_PRO,
              max: env.STRIPE_PRICE_MAX,
              team: env.STRIPE_PRICE_TEAM,
            },
            ...(mock ? { baseUrl: `${mock}/stripe` } : {}),
          }),
        }
      : {}),
    ...(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET
      ? {
          razorpay: createRazorpayProvider({
            keyId: env.RAZORPAY_KEY_ID,
            keySecret: env.RAZORPAY_KEY_SECRET,
            webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
            plans: {
              pro: env.RAZORPAY_PLAN_PRO,
              max: env.RAZORPAY_PLAN_MAX,
              team: env.RAZORPAY_PLAN_TEAM,
            },
            usdToInr: env.RAZORPAY_USD_TO_INR,
            ...(mock ? { baseUrl: `${mock}/razorpay` } : {}),
          }),
        }
      : {}),
  };
}

// Voice mode needs a LiveKit server; without its key and secret the routes answer 503.
const voiceRooms =
  env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL
    ? createLiveKitRooms({
        url: env.LIVEKIT_URL,
        publicUrl: env.LIVEKIT_PUBLIC_URL ?? env.LIVEKIT_URL,
        apiKey: env.LIVEKIT_API_KEY,
        apiSecret: env.LIVEKIT_API_SECRET,
      })
    : undefined;

// Users' own voices need ElevenLabs; previews use it too, or else the AI gateway's speech.
const voiceCloning = env.ELEVENLABS_API_KEY
  ? createElevenLabs({ apiKey: env.ELEVENLABS_API_KEY })
  : undefined;
const gatewaySpeech = env.AI_GATEWAY_API_KEY
  ? createGateway({ apiKey: env.AI_GATEWAY_API_KEY }).speech(env.VOICE_GATEWAY_TTS_MODEL)
  : undefined;
const speakPreview = voiceCloning
  ? voiceCloning.speak
  : gatewaySpeech
    ? async (voice: string, text: string) => {
        const result = await generateSpeech({
          model: gatewaySpeech,
          text,
          voice,
          outputFormat: "mp3",
        });
        return Buffer.from(result.audio.uint8Array);
      }
    : undefined;

// Dictation: ElevenLabs Scribe directly, or the same model through the gateway.
const gatewayTranscriber = env.AI_GATEWAY_API_KEY
  ? createGateway({ apiKey: env.AI_GATEWAY_API_KEY }).transcription("elevenlabs/scribe-v2")
  : undefined;
const transcribe = voiceCloning
  ? voiceCloning.transcribe
  : gatewayTranscriber
    ? async (audio: Buffer) => {
        const result = await transcribeAudio({ model: gatewayTranscriber, audio });
        return { text: result.text, seconds: result.durationInSeconds ?? 0 };
      }
    : undefined;

const app = createApp({
  models: registry,
  voice: {
    rooms: voiceRooms,
    maxSessionMinutes: env.VOICE_MAX_SESSION_MINUTES,
    cloning: voiceCloning,
    speak: speakPreview,
    transcribe,
    rates: {
      sttUsdPerMinute: env.VOICE_STT_USD_PER_MINUTE,
      ttsUsdPer1kChars: env.VOICE_TTS_USD_PER_1K_CHARS,
    },
  },
  payments: paymentsFromEnv(),
  config,
  logger,
  db: database.db,
  ai,
  storage: { objects, uploads, uploadEvents: env.UPLOAD_EVENTS },
  vectorIndex,
  memory: { episodes, queue: memoryQueue },
  graph,
  mailer:
    env.MAIL_TRANSPORT === "ses"
      ? createSesMailer({ region: env.AWS_REGION, from: env.MAIL_FROM })
      : createOutboxMailer({ logger }),
  signIn: {
    apiPublicUrl: env.API_PUBLIC_URL,
    providers: createSocialProviders({
      google:
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
          : undefined,
      github:
        env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
          ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
          : undefined,
      mockBaseUrl: env.SOCIAL_LOGIN_MOCK_URL,
    }),
    sms: smsFromEnv(),
    mcpResourceUrl: new URL("/mcp", env.MCP_PUBLIC_URL ?? "http://localhost:4100").toString(),
  },
  connectors: {
    box: createSecretBox(env.ENCRYPTION_KEY),
    catalog: connectorCatalog({
      githubUrl: env.GITHUB_MCP_URL,
      githubClient: env.GITHUB_MCP_CLIENT_ID
        ? {
            clientId: env.GITHUB_MCP_CLIENT_ID,
            ...(env.GITHUB_MCP_CLIENT_SECRET ? { clientSecret: env.GITHUB_MCP_CLIENT_SECRET } : {}),
          }
        : undefined,
    }),
    redirectUrl: new URL("/connectors/oauth/callback", env.API_PUBLIC_URL).toString(),
    webOrigin: env.WEB_ORIGIN[0]!,
    allowPrivate: env.CONNECTORS_ALLOW_PRIVATE_NETWORKS,
  },
  // Shared counters, so limits hold across every API instance.
  rateLimitStoreFactory: (name) =>
    new RedisStore({
      prefix: `rl:${name}:`,
      sendCommand: (command: string, ...args: string[]) =>
        rateLimitRedis.call(command, ...args) as Promise<number>,
    }),
  readinessChecks: [
    createCheck("postgres", () => pingDatabase(database.pool)),
    createCheck("redis-cache", () => redisCache.ping()),
    createCheck("redis-queue", () => redisQueue.ping()),
    createCheck("qdrant", () => vectorIndex.ping()),
    createCheck("s3", () => objects.ping()),
    createCheck("sqs", () => uploads.ping()),
    // Bolt when the graph is set up (what the app actually uses), HTTP otherwise.
    createCheck("neo4j", graph ? () => graph.ping() : httpProbe(env.NEO4J_HTTP_URL)),
  ],
});

const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, "API listening");
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");

  const forceExit = setTimeout(() => {
    logger.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled([
    database.close(),
    redisCache.quit(),
    redisQueue.quit(),
    memoryQueue.close(),
    graph?.close(),
    rateLimitRedis.quit(),
  ]);
  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
