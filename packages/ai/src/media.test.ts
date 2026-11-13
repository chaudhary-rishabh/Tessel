import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiEnvSchema } from "./env";
import { createImageGenerator, createVideoGenerator, imageCostNanoUsd } from "./media";
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

describe("createVideoGenerator", () => {
  const env = () =>
    aiEnvSchema.parse({
      AI_GATEWAY_API_KEY: "test",
      AI_GATEWAY_SDK_URL: gateway.url.replace(/\/v1$/, "/v3/ai"),
    });

  it("starts a video, reports it pending, then returns the clip", async () => {
    const generator = createVideoGenerator(env())!;
    expect(generator.modelId).toBe("google/veo-3.1-fast-generate-001");
    const { operation } = await generator.start({
      prompt: "Waves at dusk",
      aspectRatio: "16:9",
      durationSeconds: 6,
    });
    const started = gateway.requests.at(-1)!;
    expect(started.path).toBe("/v3/ai/video-model/start");
    expect(started.body).toMatchObject({
      prompt: "Waves at dusk",
      aspectRatio: "16:9",
      duration: 6,
    });

    expect(await generator.status(operation)).toEqual({ status: "pending" });
    expect(await generator.status(operation)).toEqual({ status: "pending" });
    const done = await generator.status(operation);
    expect(done.status).toBe("completed");
    if (done.status !== "completed" || !("data" in done.video)) throw new Error("No clip");
    expect(done.video.mediaType).toBe("video/mp4");
    // An MP4 starts with a file type box.
    expect(Buffer.from(done.video.data).subarray(4, 8).toString("ascii")).toBe("ftyp");
    expect(generator.costNanoUsd(6)).toBe(usdToNano(0.9));
  });

  it("reports a failed video", async () => {
    const generator = createVideoGenerator(env())!;
    const { operation } = await generator.start({
      prompt: "MOCK_VIDEO_FAIL",
      aspectRatio: "9:16",
      durationSeconds: 4,
    });
    await generator.status(operation);
    await generator.status(operation);
    expect(await generator.status(operation)).toEqual({
      status: "error",
      error: "The mock video model declined.",
    });
  });
});
