import { readFileSync } from "node:fs";
import { z } from "zod";
import bundledConfig from "../models.json" with { type: "json" };
import { ModelNotFoundError } from "./errors";

/** Providers Tessel can call directly when the gateway itself is down. */
export const directProviderSchema = z.enum(["openai", "anthropic"]);
export type DirectProvider = z.infer<typeof directProviderSchema>;

const modelSchema = z.object({
  /** Gateway model ID, `creator/model`. */
  id: z.string().regex(/^[a-z0-9-]+\/[a-z0-9.-]+$/, "Model IDs look like creator/model"),
  label: z.string().min(1),
  description: z.string().default(""),
  provider: z.string().min(1),
  kind: z.enum(["chat", "embedding"]),
  contextWindow: z.number().int().positive(),
  /** The most output Tessel will request in one call. */
  maxOutputTokens: z.number().int().positive().optional(),
  /** Embedding vector size. */
  dimensions: z.number().int().positive().optional(),
  /** US dollars per million tokens. */
  pricing: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    /** Price for input tokens served from the provider's prompt cache. Defaults to `input`. */
    cachedInput: z.number().nonnegative().optional(),
  }),
  capabilities: z.array(z.enum(["tools", "vision", "reasoning"])).default([]),
  /** Lowest plan that may use the model. Enforced from step 19. */
  tier: z.enum(["free", "pro"]).default("free"),
  /** Shown in the model picker. Utility and embedding models are not. */
  selectable: z.boolean().default(true),
  enabled: z.boolean().default(true),
  /** Emergency route straight to a provider when the gateway is unreachable. */
  fallback: z.object({ provider: directProviderSchema, model: z.string().min(1) }).optional(),
});

export const modelsConfigSchema = z
  .object({
    defaults: z.object({
      /** Chat model used when a request doesn't name one. */
      chat: z.string(),
      /** Cheap model for titles, classification, and other background work. */
      utility: z.string(),
      moderation: z.string(),
      embedding: z.string(),
    }),
    models: z.array(modelSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const byId = new Map<string, ModelInfo>();
    config.models.forEach((model, index) => {
      if (byId.has(model.id)) {
        ctx.addIssue({ code: "custom", path: ["models", index, "id"], message: "Duplicate ID" });
      }
      byId.set(model.id, model);
    });
    for (const [role, id] of Object.entries(config.defaults)) {
      const model = byId.get(id);
      const kind = role === "embedding" ? "embedding" : "chat";
      if (!model || !model.enabled || model.kind !== kind) {
        ctx.addIssue({
          code: "custom",
          path: ["defaults", role],
          message: `Must name an enabled ${kind} model`,
        });
      }
    }
  });

export type ModelInfo = z.infer<typeof modelSchema>;
export type ModelsConfig = z.infer<typeof modelsConfigSchema>;
export type ModelRole = keyof ModelsConfig["defaults"];

export interface ModelRegistry {
  /** Every enabled model. */
  list(filter?: { kind?: ModelInfo["kind"]; selectable?: boolean }): ModelInfo[];
  /** An enabled model by ID. Throws ModelNotFoundError otherwise. */
  get(id: string): ModelInfo;
  /** The model configured for a role, such as the default chat model. */
  forRole(role: ModelRole): ModelInfo;
  /** `id` when given, otherwise the default for `role`. */
  resolve(id: string | undefined, role: ModelRole): ModelInfo;
}

export function createModelRegistry(input: unknown): ModelRegistry {
  const config = modelsConfigSchema.parse(input);
  const enabled = config.models.filter((model) => model.enabled);
  const byId = new Map(enabled.map((model) => [model.id, model]));

  const get = (id: string): ModelInfo => {
    const model = byId.get(id);
    if (!model) throw new ModelNotFoundError(id);
    return model;
  };

  return {
    list: ({ kind, selectable } = {}) =>
      enabled.filter(
        (model) =>
          (kind === undefined || model.kind === kind) &&
          (selectable === undefined || model.selectable === selectable),
      ),
    get,
    forRole: (role) => get(config.defaults[role]),
    resolve: (id, role) => (id ? get(id) : get(config.defaults[role])),
  };
}

/**
 * The registry from `packages/ai/models.json`, or from the JSON file at
 * `path` (AI_MODELS_FILE) so operators can change models without a rebuild.
 */
export function loadModelRegistry(path?: string): ModelRegistry {
  const config: unknown = path ? JSON.parse(readFileSync(path, "utf8")) : bundledConfig;
  return createModelRegistry(config);
}
