import {
  createAi,
  createSpendGuard,
  loadModelRegistry,
  memorySpendStore,
  type Ai,
  type ModelRegistry,
} from "@tessel/ai";
import { startMockGateway } from "@tessel/ai/testing";
import { createLogger } from "@tessel/logger";
import { startCassetteProxy, type CassetteProxy } from "./cassette";
import { createJudge } from "./judge";
import type { EvalContext, EvalMode } from "./types";
import { createUsageMeter, type UsageMeter } from "./usage";

/** The date every prompt is built with, so recordings stay valid. */
export const EVAL_CLOCK = new Date("2026-06-15T09:00:00.000Z");

export const DEFAULT_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1";

export interface ContextOptions {
  mode: EvalMode;
  /** Live mode: save responses to the cassette as they come back. */
  record?: boolean;
  /** Where this suite's recordings live. */
  cassetteDir: string;
  gatewayUrl?: string;
  gatewayKey?: string;
  /** The model that grades answers in replay and live modes. */
  judgeModel?: string;
}

export interface OpenedContext {
  context: EvalContext;
  /** Misses and hits of the cassette, for the report. */
  cassette?: CassetteProxy;
  close(): Promise<void>;
}

const quiet = createLogger("evals", { level: "silent", pretty: false });

/**
 * The AI client a suite uses: pointed at the mode's gateway, with usage going
 * to the suite's meter, no moderation, and caps high enough to never trip.
 */
export function createEvalAi(
  context: Pick<EvalContext, "gatewayUrl" | "gatewayKey" | "usage">,
  {
    registry = loadModelRegistry(),
    timeoutMs = 60_000,
  }: { registry?: ModelRegistry; timeoutMs?: number } = {},
): Ai {
  return createAi({
    gateway: { apiKey: context.gatewayKey, baseURL: context.gatewayUrl },
    registry,
    spend: createSpendGuard({
      store: memorySpendStore(),
      limits: { userDailyUsd: 1_000, workspaceDailyUsd: 1_000, globalDailyUsd: 1_000 },
      logger: quiet,
    }),
    ledger: context.usage,
    moderation: { mode: "off", failure: "allow" },
    logger: quiet,
    timeoutMs,
  });
}

/** Starts what a mode needs (mock gateway, cassette proxy) and builds the suite's context. */
export async function openContext(options: ContextOptions): Promise<OpenedContext> {
  const usage: UsageMeter = createUsageMeter();
  const closers: (() => Promise<void>)[] = [];
  let gatewayUrl: string;
  let gatewayKey = options.gatewayKey ?? "";
  let mock: EvalContext["mock"];
  let cassette: CassetteProxy | undefined;

  if (options.mode === "mock") {
    mock = await startMockGateway();
    closers.push(() => mock!.close());
    gatewayUrl = mock.url;
    gatewayKey = "mock";
  } else if (options.mode === "replay") {
    cassette = await startCassetteProxy({ mode: "replay", directory: options.cassetteDir });
    closers.push(() => cassette!.close());
    gatewayUrl = cassette.url;
    gatewayKey = "replay";
  } else {
    if (!gatewayKey) throw new Error("Live evals need AI_GATEWAY_API_KEY");
    const upstream = options.gatewayUrl ?? DEFAULT_GATEWAY_URL;
    if (options.record) {
      cassette = await startCassetteProxy({
        mode: "record",
        directory: options.cassetteDir,
        upstream,
        apiKey: gatewayKey,
      });
      closers.push(() => cassette!.close());
      gatewayUrl = cassette.url;
    } else {
      gatewayUrl = upstream;
    }
  }

  const base = { mode: options.mode, gatewayUrl, gatewayKey, usage, now: EVAL_CLOCK };
  const judge =
    options.mode === "mock"
      ? undefined
      : createJudge(
          // The judge's spend is counted with the suite's, so the report shows the full cost.
          createEvalAi(base),
          options.judgeModel ?? loadModelRegistry().forRole("chat").id,
        );
  const context: EvalContext = { ...base, ...(judge ? { judge } : {}), ...(mock ? { mock } : {}) };
  return {
    context,
    ...(cassette ? { cassette } : {}),
    async close() {
      for (const close of closers.reverse()) await close();
    },
  };
}
