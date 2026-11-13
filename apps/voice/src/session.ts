import { inference, llm, voice, type JobContext, type metrics, type VAD } from "@livekit/agents";
import { CostCapExceededError } from "@tessel/ai";
import { VOICE_INTERRUPT_RPC, voiceDispatchMetadataSchema } from "@tessel/contracts";
import { turnTimings, type StageMetrics } from "./latency";
import { GatewayLLM } from "./model";
import { voiceInstructions } from "./prompt";
import type { VoiceRuntime } from "./runtime";
import { createSpeechProviders, type SpeechProviders } from "./speech/providers";
import type { VoiceSessionContext } from "./store";
import { createVoiceUsage } from "./usage";

/** Said when today's spend cap is reached mid-conversation, before the call ends. */
export const SPEND_LIMIT_MESSAGE =
  "You've reached today's AI limit, so I have to stop here. You can carry on tomorrow, or upgrade in Settings.";
/** Said when the conversation reaches its time limit. */
export const TIME_LIMIT_MESSAGE =
  "We've reached the time limit for one voice chat. Start a new one whenever you like.";

/** How a session ended, from LiveKit's close reason. */
function endReasonFor(reason: string): string {
  switch (reason) {
    case voice.CloseReason.PARTICIPANT_DISCONNECTED:
      return "user_left";
    case voice.CloseReason.USER_INITIATED:
      return "user_ended";
    case voice.CloseReason.ERROR:
      return "error";
    case voice.CloseReason.JOB_SHUTDOWN:
      return "shutdown";
    default:
      return reason || "ended";
  }
}

/**
 * The agent: the voice prompt and the conversation so far, plus a spend-cap
 * check before every reply (a capped user hears why and the call ends).
 */
class TesselVoiceAgent extends voice.Agent {
  readonly #beforeReply: () => Promise<boolean>;

  constructor(options: voice.AgentOptions<unknown> & { beforeReply: () => Promise<boolean> }) {
    const { beforeReply, ...agentOptions } = options;
    super(agentOptions);
    this.#beforeReply = beforeReply;
  }

  override async onUserTurnCompleted(): Promise<void> {
    if (!(await this.#beforeReply())) throw new voice.StopResponse();
  }
}

/** The parts of LiveKit's job context the session uses. */
export type VoiceJob = Pick<JobContext, "connect" | "shutdown"> & {
  job: { metadata: string };
  /** The room to talk in; tests that pass their own audio in and out have none. */
  room?: JobContext["room"];
};

export interface SessionParts {
  /** Voice activity detection; tests that end turns from the transcript pass none. */
  vad?: VAD | null;
  /** Overrides for tests: fake speech and model. */
  speech?: SpeechProviders;
  model?: llm.LLM;
  /** Overrides the turn detector (tests use the STT's end of speech instead). */
  turnDetection?: voice.AgentSessionOptions["turnDetection"];
  /** Audio in and out without a room, for tests. */
  io?: { input: voice.AudioInput; output: voice.AudioOutput };
}

/**
 * Runs one voice conversation: the session the API created (named in the
 * dispatch metadata), the chat it continues, a speech-to-text, model, and
 * text-to-speech pipeline tuned for latency, and everything saved as it
 * happens: messages, turn timings, usage.
 */
export async function runVoiceSession(
  ctx: VoiceJob,
  runtime: VoiceRuntime,
  parts: SessionParts,
): Promise<voice.AgentSession | undefined> {
  const { env, logger, store, registry, spend } = runtime;

  const dispatch = voiceDispatchMetadataSchema.safeParse(
    (() => {
      try {
        return JSON.parse(ctx.job.metadata || "{}");
      } catch {
        return undefined;
      }
    })(),
  );
  if (!dispatch.success) {
    logger.warn({ room: ctx.room?.name }, "Voice job without a valid session; leaving");
    ctx.shutdown("invalid_dispatch");
    return undefined;
  }
  const opened = await store.open(dispatch.data.voiceSessionId);
  if (!opened) {
    // Ended (replaced, or by the browser) before the agent arrived.
    logger.info({ voiceSessionId: dispatch.data.voiceSessionId }, "Voice session is not open");
    ctx.shutdown("session_not_open");
    return undefined;
  }
  const { session: saved, history } = opened;
  const log = logger.child({ voiceSessionId: saved.id, threadId: saved.threadId });

  const model = registry.get(saved.modelId);
  const speech = parts.speech ?? createSpeechProviders(env);
  const chatModel =
    parts.model ??
    new GatewayLLM({
      apiKey: env.AI_GATEWAY_API_KEY ?? "",
      baseURL: env.AI_GATEWAY_URL,
      modelId: model.id,
      reasons: model.capabilities.includes("reasoning"),
    });

  const chatCtx = llm.ChatContext.empty();
  for (const message of history) chatCtx.addMessage(message);

  const subject = { workspaceId: saved.workspaceId, userId: saved.userId };
  let endReason: string | undefined;
  let closing = false;

  const session = new voice.AgentSession({
    stt: speech.stt,
    tts: speech.tts,
    llm: chatModel,
    vad: parts.vad ?? null,
    turnHandling: {
      // The end-of-turn model listens to how they speak, not just for silence, so a
      // trailing "um, and then…" doesn't end a turn. It runs on-device, in the job process.
      turnDetection: parts.turnDetection ?? new inference.TurnDetector({ version: "v1-mini" }),
      endpointing: {
        mode: "dynamic",
        minDelay: env.VOICE_ENDPOINTING_MIN_MS,
        maxDelay: env.VOICE_ENDPOINTING_MAX_MS,
      },
      // Start the reply on the transcript before the turn is confirmed; dropped if they keep talking.
      preemptiveGeneration: { enabled: true },
    },
    // A long silence isn't a reason to talk; the time limit ends abandoned calls.
    userAwayTimeout: null,
  });

  /** Says a last line, then ends the conversation. */
  const endWith = async (line: string, reason: string) => {
    if (closing) return;
    closing = true;
    endReason = reason;
    try {
      await session.say(line, { allowInterruptions: false, addToChatCtx: true }).waitForPlayout();
    } catch (error) {
      log.warn({ err: error }, "Couldn't say the closing line");
    }
    session.shutdown({ reason, drain: true });
  };

  const agent = new TesselVoiceAgent({
    instructions: voiceInstructions({ userName: saved.userName }),
    chatCtx,
    beforeReply: async () => {
      try {
        await spend.assertWithinBudget(subject);
        return true;
      } catch (error) {
        if (!(error instanceof CostCapExceededError)) throw error;
        void endWith(SPEND_LIMIT_MESSAGE, "spend_limit");
        return false;
      }
    },
  });

  wireSessionEvents(session, { saved, runtime, speech, log });

  const timeLimit = setTimeout(
    () => void endWith(TIME_LIMIT_MESSAGE, "time_limit"),
    env.VOICE_MAX_SESSION_MINUTES * 60_000,
  );
  timeLimit.unref();

  session.on(voice.AgentSessionEventTypes.Close, (event) => {
    clearTimeout(timeLimit);
    endReason ??= endReasonFor(event.reason);
    const failed = event.error !== null || endReason === "error";
    if (event.error) log.error({ err: event.error }, "Voice session closed with an error");
    void store
      .finish(saved, { status: failed ? "failed" : "ended", endReason })
      .then(() =>
        runtime.memory.enqueue({
          workspaceId: saved.workspaceId,
          userId: saved.userId,
          threadId: saved.threadId,
        }),
      )
      .catch((error: unknown) => log.error({ err: error }, "Couldn't close the voice session"));
  });

  if (parts.io) {
    session.input.audio = parts.io.input;
    session.output.audio = parts.io.output;
    await session.start({ agent });
  } else {
    await session.start({ agent, ...(ctx.room ? { room: ctx.room } : {}) });
    await ctx.connect();
    // Tapping the visual stops the agent mid-sentence, like talking over it does.
    ctx.room?.localParticipant?.registerRpcMethod(VOICE_INTERRUPT_RPC, async () => {
      try {
        await session.interrupt().await;
        return "interrupted";
      } catch {
        // Nothing playing, or a closing line that can't be cut off.
        return "not_interrupted";
      }
    });
  }
  await store.markActive(saved, { speechProvider: speech.provider, voiceId: speech.voiceId });
  log.info({ modelId: model.id, speech: speech.provider }, "Voice session live");
  return session;
}

/**
 * Saves what's said and how fast: each user and agent message to the chat, a
 * timing row for each reply, and usage for every model and speech call.
 */
function wireSessionEvents(
  session: voice.AgentSession,
  {
    saved,
    runtime,
    speech,
    log,
  }: {
    saved: VoiceSessionContext;
    runtime: VoiceRuntime;
    speech: SpeechProviders;
    log: VoiceRuntime["logger"];
  },
) {
  const usage = createVoiceUsage(runtime.tracker, {
    subject: { workspaceId: saved.workspaceId, userId: saved.userId, sessionId: saved.id },
    registry: runtime.registry,
    rates: {
      sttUsdPerMinute: runtime.env.VOICE_STT_USD_PER_MINUTE,
      ttsUsdPer1kChars: runtime.env.VOICE_TTS_USD_PER_1K_CHARS,
    },
    sttModelId: speech.sttModelId,
    ttsModelId: speech.ttsModelId,
  });
  // The user's last message, whose end-of-turn timing pairs with the next reply.
  let lastUser: StageMetrics = {};
  // Writes go in order, so the chat reads in the order things were said.
  let writes = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    writes = writes.then(work).catch((error: unknown) => {
      log.error({ err: error }, "Couldn't save part of the voice conversation");
    });
  };

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, ({ item }) => {
    if (!(item instanceof llm.ChatMessage)) return;
    if (item.role !== "user" && item.role !== "assistant") return;
    const content = item.textContent?.trim() ?? "";
    const role = item.role;
    if (role === "user") lastUser = item.metrics;
    if (content) enqueue(() => runtime.store.addMessage(saved, { role, content }));
    if (role === "assistant") {
      const timings = turnTimings(lastUser, item.metrics);
      lastUser = {};
      if (timings) {
        log.debug({ ...timings }, "Voice turn");
        enqueue(() => runtime.store.addTurn(saved, timings, item.interrupted));
      }
    }
  });

  session.on(voice.AgentSessionEventTypes.MetricsCollected, ({ metrics: m }) => {
    void usage.record(m);
    if (m.type === "stt_metrics") {
      const audioMs = (m as metrics.STTMetrics).audioDurationMs;
      enqueue(() => runtime.store.addUserAudio(saved, audioMs));
    }
  });

  session.on(voice.AgentSessionEventTypes.Error, ({ error }) => {
    log.warn({ err: error }, "Voice pipeline error");
  });
}
