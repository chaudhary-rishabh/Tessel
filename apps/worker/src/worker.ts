import { loadEnvFiles, parseEnv } from "@tessel/config/env";
import { createLogger } from "@tessel/logger";
import { createQueueConnection, QUEUE_NAMES } from "@tessel/queue";
import { Worker } from "bullmq";
import { envSchema } from "./env";
import { processSystemJob } from "./processors/system";

const SERVICE = "worker";
const SHUTDOWN_TIMEOUT_MS = 30_000;

loadEnvFiles();
const env = parseEnv(envSchema);
const logger = createLogger(SERVICE);
const connection = createQueueConnection(env.REDIS_QUEUE_URL);

const systemWorker = new Worker(QUEUE_NAMES.system, (job) => processSystemJob(job, logger), {
  connection,
  concurrency: env.WORKER_CONCURRENCY,
});

systemWorker.on("ready", () => logger.info({ queue: QUEUE_NAMES.system }, "Worker ready"));
systemWorker.on("failed", (job, error) =>
  logger.error({ queue: QUEUE_NAMES.system, jobId: job?.id, err: error }, "Job failed"),
);
systemWorker.on("error", (error) => logger.error({ err: error }, "Worker error"));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down, waiting for running jobs");

  const forceExit = setTimeout(() => {
    logger.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  await systemWorker.close();
  await connection.quit();
  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
