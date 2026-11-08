import { z } from "zod";

/** Every queue in the system. Producers and workers import names from here. */
export const QUEUE_NAMES = {
  system: "system",
  /** Parsing, chunking, embedding, and indexing uploaded documents. */
  documents: "documents",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Payload schemas per queue and job name. Workers validate before processing. */
export const jobSchemas = {
  system: {
    ping: z.object({
      requestedAt: z.iso.datetime(),
      source: z.string().min(1),
    }),
  },
  documents: {
    ingest: z.object({
      workspaceId: z.uuid(),
      documentId: z.uuid(),
    }),
  },
} as const;

export type IngestJobData = z.infer<typeof jobSchemas.documents.ingest>;

/**
 * One ingest job per document at a time: the job ID comes from the document
 * ID, and jobs are removed when they finish so a document can be re-queued.
 */
export const ingestJobId = (documentId: string) => `ingest-${documentId}`;

export type SystemJobName = keyof typeof jobSchemas.system;
export type SystemJobData<N extends SystemJobName> = z.infer<(typeof jobSchemas.system)[N]>;

export function isSystemJobName(name: string): name is SystemJobName {
  return Object.hasOwn(jobSchemas.system, name);
}
