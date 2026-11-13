import { describe, expect, it } from "vitest";
import { percentile, turnTimings } from "./latency";

describe("turn timings", () => {
  it("splits a reply's delay by stage, in milliseconds", () => {
    expect(
      turnTimings(
        { endOfTurnDelay: 0.21 },
        { llmNodeTtft: 0.18, ttsNodeTtfb: 0.12, e2eLatency: 0.512 },
      ),
    ).toEqual({
      endOfTurnMs: 210,
      modelFirstTokenMs: 180,
      firstAudioMs: 120,
      totalMs: 512,
      preemptive: false,
    });
  });

  it("marks a reply drafted before the turn ended", () => {
    // The model started on the transcript, so the user heard less than the stages add up to.
    const timings = turnTimings(
      { endOfTurnDelay: 0.4 },
      { llmNodeTtft: 0.3, ttsNodeTtfb: 0.1, e2eLatency: 0.45 },
    );
    expect(timings).toMatchObject({ totalMs: 450, preemptive: true });
  });

  it("adds the stages up when LiveKit didn't report the end-to-end delay", () => {
    expect(
      turnTimings({ endOfTurnDelay: 0.2 }, { llmNodeTtft: 0.2, ttsNodeTtfb: 0.1 })?.totalMs,
    ).toBe(500);
  });

  it("skips replies with no timings, such as one interrupted before it spoke", () => {
    expect(turnTimings({ endOfTurnDelay: 0.2 }, { llmNodeTtft: 0.2 })).toBeUndefined();
    expect(turnTimings({}, {})).toBeUndefined();
  });

  it("ignores negative or missing stage values", () => {
    expect(
      turnTimings({ endOfTurnDelay: -1 }, { llmNodeTtft: 0.1, ttsNodeTtfb: 0.1 }),
    ).toMatchObject({ endOfTurnMs: 0, totalMs: 200 });
  });
});

describe("percentile", () => {
  it("uses the nearest rank", () => {
    const values = [500, 300, 700, 400, 900, 600, 350, 450, 800, 1200];
    expect(percentile(values, 50)).toBe(500);
    expect(percentile(values, 95)).toBe(1200);
    expect(percentile([420], 95)).toBe(420);
  });

  it("is undefined with nothing to measure", () => {
    expect(percentile([], 50)).toBeUndefined();
  });
});
