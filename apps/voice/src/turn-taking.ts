import { voice } from "@livekit/agents";
import type { Logger } from "@tessel/logger";

/**
 * What a short utterance means for turn-taking:
 * - backchannel: the listener's "mm-hmm", "yeah", "haan" while the agent
 *   talks. The agent keeps going.
 * - stop: "stop", "wait", "hold on", "ruko". The agent goes quiet at once and
 *   doesn't reply.
 * - cancel: "never mind", "cancel that", "forget it", "rehne do". The agent
 *   stops, drops what it was doing (including a lookup in progress), and
 *   acknowledges in a word or two.
 * - speech: anything with content; it interrupts once it's long enough.
 * - empty: nothing recognisable yet.
 */
export type UtteranceKind = "backchannel" | "stop" | "cancel" | "speech" | "empty";

/** Lower case, accents and punctuation removed, single spaces; keeps Devanagari. */
export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const phrases = (...items: string[]) => new Set(items.map(normalizeUtterance));

/** Listener sounds and short agreements, in English, Hindi (both scripts), and Spanish. */
const BACKCHANNELS = phrases(
  "mm",
  "mmm",
  "mhm",
  "mm hmm",
  "mmhmm",
  "hmm",
  "hm",
  "uh huh",
  "uhhuh",
  "um",
  "uh",
  "ah",
  "oh",
  "yeah",
  "yea",
  "yes",
  "yep",
  "yup",
  "ok",
  "okay",
  "k",
  "right",
  "sure",
  "i see",
  "got it",
  "cool",
  "nice",
  "great",
  "alright",
  "all right",
  "true",
  "exactly",
  "totally",
  "of course",
  "go on",
  "really",
  "wow",
  "makes sense",
  "fair",
  "fair enough",
  "sounds good",
  "perfect",
  "haan",
  "han",
  "ha",
  "haa",
  "hanji",
  "haan ji",
  "ji",
  "achha",
  "acha",
  "accha",
  "achcha",
  "theek hai",
  "thik hai",
  "theek",
  "thik",
  "sahi",
  "sahi hai",
  "bilkul",
  "हाँ",
  "हां",
  "जी",
  "हाँ जी",
  "अच्छा",
  "ठीक है",
  "ठीक",
  "सही",
  "सही है",
  "बिल्कुल",
  "sí",
  "si",
  "vale",
  "claro",
  "ajá",
);

const STOPS = phrases(
  "stop",
  "stop it",
  "stop talking",
  "stop there",
  "wait",
  "hold on",
  "hang on",
  "hold up",
  "one second",
  "one sec",
  "just a second",
  "pause",
  "quiet",
  "be quiet",
  "shh",
  "shush",
  "shut up",
  "enough",
  "thats enough",
  "ruko",
  "ruk jao",
  "ruko ruko",
  "bas",
  "bas karo",
  "bas bas",
  "ek minute",
  "ek second",
  "रुको",
  "रुक जाओ",
  "बस",
  "बस करो",
  "एक मिनट",
  "para",
  "espera",
  "alto",
);

const CANCELS = phrases(
  "cancel",
  "cancel that",
  "cancel it",
  "never mind",
  "nevermind",
  "forget it",
  "forget about it",
  "forget that",
  "scratch that",
  "dont do that",
  "dont",
  "leave it",
  "skip it",
  "skip that",
  "rehne do",
  "rahne do",
  "chhodo",
  "chodo",
  "chhod do",
  "jane do",
  "jaane do",
  "रहने दो",
  "छोड़ो",
  "छोड़ दो",
  "जाने दो",
  "olvídalo",
  "cancela",
);

/** Words that can wrap a command without changing it ("no, stop please"). */
const WRAPPERS = phrases(
  "no",
  "nah",
  "okay",
  "ok",
  "oh",
  "actually",
  "please",
  "sorry",
  "hey",
  "um",
  "uh",
  "just",
  "tessel",
  "thanks",
  "thank you",
  "arre",
  "nahi",
  "नहीं",
  "अरे",
);

const LONGEST_PHRASE = 3;

/** Splits words into known phrases, longest first; undefined if any word isn't in a set. */
function segment(words: string[], ...sets: Set<string>[]): string[] | undefined {
  const parts: string[] = [];
  let index = 0;
  while (index < words.length) {
    let matched = 0;
    for (let length = Math.min(LONGEST_PHRASE, words.length - index); length > 0; length--) {
      const candidate = words.slice(index, index + length).join(" ");
      if (sets.some((set) => set.has(candidate))) {
        parts.push(candidate);
        matched = length;
        break;
      }
    }
    if (!matched) return undefined;
    index += matched;
  }
  return parts;
}

/** Words that carry content, ignoring fillers like "um" and "okay". */
export function contentWords(text: string): number {
  const words = normalizeUtterance(text).split(" ").filter(Boolean);
  return words.filter((word) => !BACKCHANNELS.has(word) && !WRAPPERS.has(word)).length;
}

export function classifyUtterance(text: string): UtteranceKind {
  const normalized = normalizeUtterance(text);
  if (!normalized) return "empty";
  const words = normalized.split(" ");
  if (words.length <= 6) {
    const parts = segment(words, CANCELS, STOPS, WRAPPERS, BACKCHANNELS);
    if (parts) {
      if (parts.some((part) => CANCELS.has(part))) return "cancel";
      if (parts.some((part) => STOPS.has(part))) return "stop";
      // A bare "no" disagrees rather than listens, so it needs a listener sound to count.
      if (
        words.length <= 4 &&
        parts.some((part) => BACKCHANNELS.has(part)) &&
        parts.every((part) => BACKCHANNELS.has(part) || WRAPPERS.has(part))
      ) {
        return "backchannel";
      }
    }
  }
  return "speech";
}

/** The parts of the session the controller listens to and acts on. */
export interface TurnTakingSession {
  on(
    event: voice.AgentSessionEventTypes.UserInputTranscribed,
    listener: (event: { transcript: string; isFinal: boolean }) => void,
  ): unknown;
  on(
    event: voice.AgentSessionEventTypes.AgentStateChanged,
    listener: (event: { newState: string }) => void,
  ): unknown;
  on(
    event: voice.AgentSessionEventTypes.UserStateChanged,
    listener: (event: { newState: string }) => void,
  ): unknown;
  interrupt(): { await: Promise<unknown> };
}

export interface TurnTakingStats {
  /** Listener sounds spoken over the agent that it carried on through. */
  backchannels: number;
  stops: number;
  cancels: number;
  /** Times the controller cut the agent off. */
  interruptions: number;
}

/** What to do with a finished user turn. */
export type TurnCommand = "stop" | "cancel" | "ignore";

export interface TurnTaking {
  /**
   * Called when a user turn ends, with its transcript: "stop" when the agent
   * should stay quiet, "cancel" when it should only acknowledge, "ignore" for
   * a backchannel spoken over the agent, undefined for a normal reply.
   */
  commandFor(text: string): TurnCommand | undefined;
  readonly stats: TurnTakingStats;
}

const BUSY_STATES = new Set(["speaking", "thinking"]);

/**
 * Decides when the user's speech should cut the agent off, from the live
 * transcript rather than from sound alone, so a listener's "mm-hmm" doesn't
 * stop a reply but "stop" or a real question does, at once.
 *
 * The session's own audio-activity interruption is turned off (see
 * `interruptionFor`); this interrupts through the session instead. While the
 * agent speaks or thinks, every interim and final transcript of the user's
 * current utterance is classified: a command interrupts on its first word,
 * other speech once it has `minWords` content words, and backchannels never.
 * An utterance that never interrupted is dropped by the session when its turn
 * ends (it's below the session's word threshold while the agent talks), and
 * one that outlasts the agent's reply is ignored through `commandFor`, so a
 * backchannel never gets a reply of its own.
 */
export function attachTurnTaking(
  session: TurnTakingSession,
  { minWords, logger }: { minWords: number; logger: Pick<Logger, "debug"> },
): TurnTaking {
  const stats: TurnTakingStats = { backchannels: 0, stops: 0, cancels: 0, interruptions: 0 };
  let agentState = "initializing";
  let finals: string[] = [];
  let interim = "";
  /** Whether the current utterance began while the agent was speaking or thinking. */
  let overlapped = false;
  /** Set once the current utterance has interrupted, or counted as a backchannel. */
  let decided: UtteranceKind | undefined;

  const reset = () => {
    finals = [];
    interim = "";
    overlapped = BUSY_STATES.has(agentState);
    decided = undefined;
  };

  const interrupt = (reason: UtteranceKind) => {
    stats.interruptions += 1;
    logger.debug({ reason, agentState }, "Voice: interrupting the agent");
    try {
      void session.interrupt().await.catch(() => undefined);
    } catch {
      // Nothing playing, or a closing line that can't be cut off.
    }
  };

  session.on(voice.AgentSessionEventTypes.AgentStateChanged, ({ newState }) => {
    agentState = newState;
  });
  session.on(voice.AgentSessionEventTypes.UserStateChanged, ({ newState }) => {
    if (newState === "speaking") reset();
  });
  session.on(voice.AgentSessionEventTypes.UserInputTranscribed, ({ transcript, isFinal }) => {
    if (!finals.length && !interim) overlapped ||= BUSY_STATES.has(agentState);
    if (isFinal) {
      finals.push(transcript);
      interim = "";
    } else {
      interim = transcript;
    }
    if (!BUSY_STATES.has(agentState) || (decided && decided !== "backchannel")) return;
    const text = [...finals, interim].join(" ");
    const kind = classifyUtterance(text);
    if (kind === "stop" || kind === "cancel") {
      decided = kind;
      stats[kind === "stop" ? "stops" : "cancels"] += 1;
      interrupt(kind);
    } else if (kind === "speech" && contentWords(text) >= minWords) {
      decided = kind;
      interrupt(kind);
    } else if (kind === "backchannel" && isFinal && !decided) {
      decided = kind;
      stats.backchannels += 1;
      logger.debug({ agentState }, "Voice: backchannel, carrying on");
    }
  });

  return {
    stats,
    commandFor(text) {
      const kind = classifyUtterance(text);
      const wasOverlapped = overlapped;
      reset();
      overlapped = false;
      if (kind === "stop" || kind === "cancel") return kind;
      if (kind === "backchannel" && wasOverlapped) return "ignore";
      return undefined;
    },
  };
}

type InterruptionConfig = NonNullable<
  NonNullable<voice.AgentSessionOptions["turnHandling"]>["interruption"]
>;

/**
 * Interruption settings for the session. "smart" leaves interruption to
 * `attachTurnTaking`: the session never cuts in on sound alone (its word
 * threshold can't be reached), and user turns spoken over the agent are
 * dropped unless the controller interrupted for them. "vad" is LiveKit's
 * default: any speech pauses the agent, and it resumes if no words follow.
 */
export function interruptionFor(mode: "smart" | "vad"): InterruptionConfig {
  if (mode === "vad") return { resumeFalseInterruption: true, falseInterruptionTimeout: 1_500 };
  return {
    minWords: Number.MAX_SAFE_INTEGER,
    resumeFalseInterruption: false,
    // Keep transcribing while the agent talks, so commands are heard.
    discardAudioIfUninterruptible: false,
  };
}
