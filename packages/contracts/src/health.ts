import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});

export const dependencyCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["up", "down"]),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.string(),
  checks: z.array(dependencyCheckSchema),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
