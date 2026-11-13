import {
  defineAgent,
  inference,
  type JobContext,
  type JobProcess,
  type VAD,
} from "@livekit/agents";
import { getRuntime } from "./runtime";
import { runVoiceSession } from "./session";

/**
 * The job each LiveKit dispatch runs, in a process LiveKit keeps warm:
 * prewarm opens the connections and loads voice activity detection once, so
 * a new conversation starts without waiting for them.
 */
export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    const runtime = await getRuntime();
    // On-device (LiveKit's native inference, weights included), so no model download.
    proc.userData.vad = new inference.VAD({
      minSilenceDuration: runtime.env.VOICE_VAD_SILENCE_MS,
      // Keep a little audio from before speech starts, so first syllables aren't clipped.
      prefixPaddingDuration: 300,
    });
  },
  entry: async (ctx: JobContext) => {
    const runtime = await getRuntime();
    await runVoiceSession(ctx, runtime, { vad: ctx.proc.userData.vad as VAD });
  },
});
