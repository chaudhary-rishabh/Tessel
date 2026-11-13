import { createGateway, generateImage } from "ai";
import type { AiEnv } from "./env";
import { usdToNano } from "./usage";

export interface ImageGenerationRequest {
  prompt: string;
  /** Like "1:1" or "16:9". */
  aspectRatio: `${number}:${number}`;
  /** Images to edit or combine; empty for a new image. */
  sources: Uint8Array[];
  signal?: AbortSignal;
}

export interface ImageGenerationResult {
  images: Uint8Array[];
  costNanoUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/** Makes and edits images through the gateway. */
export interface ImageGenerator {
  modelId: string;
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

export interface ImagePricing {
  inputUsdPerM: number;
  outputUsdPerM: number;
  usdPerImage: number;
}

/**
 * What a generation cost: the gateway's own figure when it reports one,
 * otherwise from the tokens used, otherwise a flat price per image.
 */
export function imageCostNanoUsd(
  result: {
    images: number;
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    reportedUsd?: number | undefined;
  },
  pricing: ImagePricing,
): number {
  if (result.reportedUsd !== undefined && Number.isFinite(result.reportedUsd)) {
    return usdToNano(result.reportedUsd);
  }
  if (result.inputTokens || result.outputTokens) {
    return usdToNano(
      ((result.inputTokens ?? 0) * pricing.inputUsdPerM +
        (result.outputTokens ?? 0) * pricing.outputUsdPerM) /
        1_000_000,
    );
  }
  return usdToNano(result.images * pricing.usdPerImage);
}

function reportedCost(metadata: unknown): number | undefined {
  const gateway = (metadata as { gateway?: { cost?: unknown } } | undefined)?.gateway;
  const cost = typeof gateway?.cost === "string" ? Number(gateway.cost) : gateway?.cost;
  return typeof cost === "number" ? cost : undefined;
}

/** The gateway's image model, or undefined without a gateway key. */
export function createImageGenerator(env: AiEnv): ImageGenerator | undefined {
  if (!env.AI_GATEWAY_API_KEY) return undefined;
  const gateway = createGateway({
    apiKey: env.AI_GATEWAY_API_KEY,
    baseURL: env.AI_GATEWAY_SDK_URL,
  });
  const model = gateway.imageModel(env.AI_IMAGE_MODEL);
  const pricing: ImagePricing = {
    inputUsdPerM: env.AI_IMAGE_INPUT_USD_PER_M,
    outputUsdPerM: env.AI_IMAGE_OUTPUT_USD_PER_M,
    usdPerImage: env.AI_IMAGE_USD_PER_IMAGE,
  };
  return {
    modelId: env.AI_IMAGE_MODEL,
    async generate({ prompt, aspectRatio, sources, signal }) {
      const result = await generateImage({
        model,
        prompt: sources.length > 0 ? { images: sources, text: prompt } : prompt,
        aspectRatio,
        n: 1,
        maxRetries: 1,
        ...(signal ? { abortSignal: signal } : {}),
      });
      const inputTokens = result.usage?.inputTokens ?? 0;
      const outputTokens = result.usage?.outputTokens ?? 0;
      return {
        images: result.images.map((image) => image.uint8Array),
        inputTokens,
        outputTokens,
        costNanoUsd: imageCostNanoUsd(
          {
            images: result.images.length,
            inputTokens,
            outputTokens,
            reportedUsd: reportedCost(result.providerMetadata),
          },
          pricing,
        ),
      };
    },
  };
}
