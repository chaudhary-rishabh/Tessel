/**
 * Voice latency, split by stage. LiveKit reports these per message, in
 * seconds: the user's message carries how long turn detection and the
 * transcript took; the agent's reply carries the model's first token, the
 * first audio, and the end-to-end delay the user heard.
 */
export interface StageMetrics {
  /** User message: end of speech until the turn was declared over. */
  endOfTurnDelay?: number | undefined;
  /** Agent message: request until the model's first token. */
  llmNodeTtft?: number | undefined;
  /** Agent message: first text sent to speech until the first audio. */
  ttsNodeTtfb?: number | undefined;
  /** Agent message: end of the user's speech until the first audio of the reply. */
  e2eLatency?: number | undefined;
}

export interface TurnTimings {
  endOfTurnMs: number;
  modelFirstTokenMs: number;
  firstAudioMs: number;
  totalMs: number;
  /** The reply was drafted before the turn ended, so the stages overlapped. */
  preemptive: boolean;
}

const ms = (seconds: number | undefined) =>
  seconds === undefined || !Number.isFinite(seconds) || seconds < 0
    ? undefined
    : Math.round(seconds * 1000);

/** Overlap smaller than this is measurement noise, not a reply drafted early. */
const PREEMPTIVE_SLACK_MS = 50;

/**
 * One turn's timings, or undefined when the reply has no timings to report
 * (a reply that was interrupted before any audio, for example).
 */
export function turnTimings(user: StageMetrics, reply: StageMetrics): TurnTimings | undefined {
  const endOfTurnMs = ms(user.endOfTurnDelay) ?? 0;
  const modelFirstTokenMs = ms(reply.llmNodeTtft);
  const firstAudioMs = ms(reply.ttsNodeTtfb);
  if (modelFirstTokenMs === undefined || firstAudioMs === undefined) return undefined;

  const sequential = endOfTurnMs + modelFirstTokenMs + firstAudioMs;
  const totalMs = ms(reply.e2eLatency) ?? sequential;
  return {
    endOfTurnMs,
    modelFirstTokenMs,
    firstAudioMs,
    totalMs,
    preemptive: totalMs + PREEMPTIVE_SLACK_MS < sequential,
  };
}

/** The value below which `p` percent of `values` fall (nearest rank). */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}
