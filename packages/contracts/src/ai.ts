import { z } from "zod";

export const modelCapabilitySchema = z.enum(["tools", "vision", "reasoning"]);

/** A model as shown in the model picker. Prices and routing stay on the server. */
export const modelSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  provider: z.string(),
  contextWindow: z.number().int(),
  capabilities: z.array(modelCapabilitySchema),
  tier: z.enum(["free", "pro"]),
});

export const modelListResponseSchema = z.object({
  models: z.array(modelSummarySchema),
  defaultModel: z.string(),
});

export const completionMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1, "Message is empty").max(100_000),
});

export const completionRequestSchema = z.object({
  model: z.string().max(120).optional(),
  system: z.string().max(20_000).optional(),
  messages: z
    .array(completionMessageSchema)
    .min(1)
    .max(200)
    .refine(
      (messages) => messages.at(-1)?.role === "user",
      "The last message must be from the user",
    ),
  maxOutputTokens: z.number().int().min(1).max(32_000).optional(),
});

export const usageAmountsSchema = z.object({
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
});

export const completionResponseSchema = z.object({
  message: z.object({ role: z.literal("assistant"), content: z.string() }),
  model: z.string(),
  usage: usageAmountsSchema,
});

export const usageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

const usageTotalsSchema = usageAmountsSchema.extend({ calls: z.number().int() });

/** A spend cap for today. `limitUsd` is null when the cap is off. */
export const dailySpendSchema = z.object({
  spentUsd: z.number(),
  limitUsd: z.number().nullable(),
});

export const usageSummarySchema = z.object({
  /** Owners and admins see the whole workspace; members see their own usage. */
  scope: z.enum(["user", "workspace"]),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  totals: usageTotalsSchema,
  byModel: z.array(usageTotalsSchema.extend({ modelId: z.string(), label: z.string() })),
  byFeature: z.array(usageTotalsSchema.extend({ feature: z.string() })),
  byDay: z.array(z.object({ day: z.iso.date(), calls: z.number().int(), costUsd: z.number() })),
  today: z.object({
    user: dailySpendSchema,
    workspace: dailySpendSchema,
    resetsAt: z.iso.datetime(),
  }),
});

export type ModelSummary = z.infer<typeof modelSummarySchema>;
export type ModelListResponse = z.infer<typeof modelListResponseSchema>;
export type CompletionRequest = z.infer<typeof completionRequestSchema>;
export type CompletionResponse = z.infer<typeof completionResponseSchema>;
export type UsageQuery = z.infer<typeof usageQuerySchema>;
export type UsageSummary = z.infer<typeof usageSummarySchema>;
