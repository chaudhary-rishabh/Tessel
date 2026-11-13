import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiEnvSchema } from "./env";
import { createImageGenerator, imageCostNanoUsd } from "./media";
import { startMockGateway, type MockGateway } from "./testing";
import { usdToNano } from "./usage";

let gateway: MockGateway;
beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(() => gateway.close());

const pngSize = (bytes: Uint8Array) => {
  const view = Buffer.from(bytes);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
};

describe("createImageGenerator", () => {
  const env = () =>
    aiEnvSchema.parse({
      AI_GATEWAY_API_KEY: "test",
      AI_GATEWAY_SDK_URL: gateway.url.replace(/\/v1$/, "/v3/ai"),
    });

  it("is off without a gateway key", () => {
    expect(createImageGenerator(aiEnvSchema.parse({}))).toBeUndefined();
  });

  it("generates an image at the aspect ratio asked for, with its cost", async () => {
    const generator = createImageGenerator(env())!;
    expect(generator.modelId).toBe("openai/gpt-image-2");
    const result = await generator.generate({ prompt: "a fox", aspectRatio: "16:9", sources: [] });
    expect(result.images).toHaveLength(1);
    expect(pngSize(result.images[0]!)).toEqual({ width: 96, height: 54 });
    // The gateway reported $0.04.
    expect(result.costNanoUsd).toBe(usdToNano(0.04));
    const request = gateway.requests.at(-1)!;
    expect(request.path).toBe("/v3/ai/image-model");
    expect(request.headers["ai-model-id"]).toBe("openai/gpt-image-2");
    expect(request.body).toMatchObject({ prompt: "a fox", aspectRatio: "16:9", n: 1 });
  });

  it("sends source images for an edit", async () => {
    const generator = createImageGenerator(env())!;
    const first = await generator.generate({ prompt: "a fox", aspectRatio: "1:1", sources: [] });
    const edited = await generator.generate({
      prompt: "make it night",
      aspectRatio: "1:1",
      sources: first.images,
    });
    expect(Buffer.from(edited.images[0]!).equals(Buffer.from(first.images[0]!))).toBe(false);
    const body = gateway.requests.at(-1)!.body as { files?: { type: string }[] };
    expect(body.files).toHaveLength(1);
  });

  it("fails when the model refuses", async () => {
    const generator = createImageGenerator(env())!;
    await expect(
      generator.generate({ prompt: "MOCK_IMAGE_FAIL", aspectRatio: "1:1", sources: [] }),
    ).rejects.toThrow(/Mock image failure/);
  });
});

describe("imageCostNanoUsd", () => {
  const pricing = { inputUsdPerM: 5, outputUsdPerM: 30, usdPerImage: 0.05 };
  it("prefers the gateway's figure, then tokens, then a flat price", () => {
    expect(imageCostNanoUsd({ images: 1, reportedUsd: 0.02, outputTokens: 9 }, pricing)).toBe(
      usdToNano(0.02),
    );
    expect(imageCostNanoUsd({ images: 1, inputTokens: 1000, outputTokens: 1000 }, pricing)).toBe(
      usdToNano(0.035),
    );
    expect(imageCostNanoUsd({ images: 2 }, pricing)).toBe(usdToNano(0.1));
  });
});
