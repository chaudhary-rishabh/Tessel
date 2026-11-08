import type { Logger } from "@tessel/logger";
import { isSystemJobName, jobSchemas } from "@tessel/queue";
import { UnrecoverableError } from "bullmq";

export interface JobLike {
  id?: string | undefined;
  name: string;
  data: unknown;
}

/**
 * Handles jobs on the `system` queue. Bad input is unrecoverable: retrying a
 * job with an unknown name or an invalid payload can never succeed, so those
 * fail immediately instead of using up retries.
 */
export async function processSystemJob(job: JobLike, logger: Logger): Promise<{ ok: true }> {
  if (!isSystemJobName(job.name)) {
    throw new UnrecoverableError(`Unknown system job "${job.name}"`);
  }

  switch (job.name) {
    case "ping": {
      const parsed = jobSchemas.system.ping.safeParse(job.data);
      if (!parsed.success) {
        throw new UnrecoverableError(`Invalid ping payload: ${parsed.error.message}`);
      }
      logger.info({ jobId: job.id, ...parsed.data }, "Ping received");
      return { ok: true };
    }
  }
}
