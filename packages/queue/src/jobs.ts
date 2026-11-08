import { z } from "zod";

/** Every queue in the system. Producers and workers import names from here. */
export const QUEUE_NAMES = {
  system: "system",
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
} as const;

export type SystemJobName = keyof typeof jobSchemas.system;
export type SystemJobData<N extends SystemJobName> = z.infer<(typeof jobSchemas.system)[N]>;

export function isSystemJobName(name: string): name is SystemJobName {
  return Object.hasOwn(jobSchemas.system, name);
}
