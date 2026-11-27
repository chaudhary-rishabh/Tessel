import { EventEmitter } from "node:events";
import { voice } from "@livekit/agents";
import { defineSuite, type EvalCase, type Score } from "@tessel/evals";
import { attachTurnTaking, type TurnCommand, type TurnTakingSession } from "../src/turn-taking";

/**
 * What the user says while the agent is in a given state, and what should
 * happen: whether the agent stops talking, and what becomes of the turn.
 */
interface TurnInput {
  /** What the transcriber hears, final segment by final segment. */
  segments: string[];
  agentState: "speaking" | "thinking" | "listening";
  interrupts: boolean;
  /** What `commandFor` should return for the finished turn. */
  command: TurnCommand | undefined;
}

interface TurnOutput {
  interrupted: boolean;
  /** Words heard when the agent was cut off. */
  wordsAtInterrupt: number | null;
  command: TurnCommand | undefined;
}

const MIN_WORDS = 2;

const cases: EvalCase<TurnInput>[] = [];
const add = (id: string, tag: string, input: TurnInput) => cases.push({ id, input, tags: [tag] });

// A listener's sounds while the agent talks: it carries on, and they get no reply.
[
  "mm-hmm",
  "mhm",
  "yeah",
  "yeah yeah",
  "okay",
  "right",
  "uh huh",
  "I see",
  "got it",
  "sure",
  "makes sense",
  "oh okay",
  "haan",
  "haan ji",
  "achha",
  "theek hai",
  "हाँ",
  "ठीक है",
].forEach((text, index) =>
  add(`backchannel-${index + 1}`, "backchannel", {
    segments: [text],
    agentState: "speaking",
    interrupts: false,
    command: "ignore",
  }),
);
add("backchannel-twice", "backchannel", {
  segments: ["mm-hmm", "yeah"],
  agentState: "speaking",
  interrupts: false,
  command: "ignore",
});
add("backchannel-while-thinking", "backchannel", {
  segments: ["okay"],
  agentState: "thinking",
  interrupts: false,
  command: "ignore",
});

// Stopping the agent mid-sentence: it goes quiet on the first word and doesn't reply.
[
  "stop",
  "wait",
  "hold on",
  "hang on",
  "one second",
  "no stop",
  "okay stop please",
  "wait wait",
  "shh",
  "ruko",
  "bas",
  "रुको",
].forEach((text, index) =>
  add(`stop-${index + 1}`, "stop", {
    segments: [text],
    agentState: "speaking",
    interrupts: true,
    command: "stop",
  }),
);

// Cancelling, including a lookup still running: it stops and only acknowledges.
[
  "never mind",
  "cancel that",
  "forget it",
  "actually never mind",
  "no forget it",
  "scratch that",
  "don't do that",
  "rehne do",
  "chhodo",
  "छोड़ दो",
].forEach((text, index) =>
  add(`cancel-${index + 1}`, "cancel", {
    segments: [text],
    agentState: index % 2 ? "thinking" : "speaking",
    interrupts: true,
    command: "cancel",
  }),
);

// Talking over the agent with something to say: it stops and answers that.
[
  "what about the travel policy",
  "sorry, I meant the Delhi trip",
  "can you say that again",
  "stop the meeting at five",
  "cancel my flight to Delhi",
  "wait, what does that mean",
  "how many days do I get",
  "kitne din ki chhutti milti hai",
  "मुझे यात्रा नीति बताओ",
].forEach((text, index) =>
  add(`barge-in-${index + 1}`, "barge-in", {
    segments: [text],
    agentState: "speaking",
    interrupts: true,
    command: undefined,
  }),
);
add("backchannel-then-question", "barge-in", {
  segments: ["yeah", "but why is that"],
  agentState: "speaking",
  interrupts: true,
  command: undefined,
});

// Short replies when it's the user's turn: answers, not backchannels.
[
  { text: "okay", command: undefined },
  { text: "yes", command: undefined },
  { text: "no", command: undefined },
  { text: "haan", command: undefined },
  { text: "stop", command: "stop" as const },
  { text: "never mind", command: "cancel" as const },
].forEach(({ text, command }, index) =>
  add(`listening-${index + 1}`, "listening", {
    segments: [text],
    agentState: "listening",
    interrupts: false,
    command,
  }),
);

/** A session that only carries events and counts interruptions. */
function fakeSession() {
  const events = new EventEmitter();
  let words = 0;
  let wordsAtInterrupt: number | null = null;
  const session: TurnTakingSession = {
    on: ((event: string, listener: (payload: never) => void) =>
      events.on(event, listener as (...args: unknown[]) => void)) as TurnTakingSession["on"],
    interrupt: () => {
      wordsAtInterrupt ??= words;
      return { await: Promise.resolve() };
    },
  };
  return {
    session,
    emit: (event: string, payload: unknown) => events.emit(event, payload),
    setWords: (count: number) => {
      words = count;
    },
    wordsAtInterrupt: () => wordsAtInterrupt,
  };
}

/** Plays one turn into the controller word by word, as a streaming transcriber reports it. */
function play(input: TurnInput): TurnOutput {
  const fake = fakeSession();
  const turns = attachTurnTaking(fake.session, {
    minWords: MIN_WORDS,
    logger: { debug: () => undefined },
  });
  fake.emit(voice.AgentSessionEventTypes.AgentStateChanged, { newState: input.agentState });
  fake.emit(voice.AgentSessionEventTypes.UserStateChanged, { newState: "speaking" });
  let heard = 0;
  for (const segment of input.segments) {
    const words = segment.split(/\s+/);
    for (let count = 1; count <= words.length; count++) {
      fake.setWords(heard + count);
      fake.emit(voice.AgentSessionEventTypes.UserInputTranscribed, {
        transcript: words.slice(0, count).join(" "),
        isFinal: count === words.length,
      });
    }
    heard += words.length;
  }
  const wordsAtInterrupt = fake.wordsAtInterrupt();
  return {
    interrupted: wordsAtInterrupt !== null,
    wordsAtInterrupt,
    command: turns.commandFor(input.segments.join(" ")),
  };
}

export default defineSuite<TurnInput, TurnOutput, undefined>({
  name: "turn-taking",
  description:
    "When talking over the voice agent stops it: backchannels carry on, stop and cancel act on the first word, real speech barges in, and what becomes of each turn.",
  modes: ["mock"],
  metrics: [
    {
      name: "false_interruptions",
      description: "Share of backchannels that cut the agent off.",
      direction: "lower",
      gate: { mock: 0 },
    },
    {
      name: "command_detection",
      description: "Spoken stop and cancel commands that stopped the agent and were understood.",
      direction: "higher",
      gate: { mock: 1 },
    },
    {
      name: "barge_in_recall",
      description: "Real speech over the agent that stopped it.",
      direction: "higher",
      gate: { mock: 1 },
    },
    {
      name: "turn_outcome",
      description:
        "Finished turns handled right: replied to, ignored, kept quiet, or acknowledged.",
      direction: "higher",
      gate: { mock: 1 },
    },
    {
      name: "words_to_stop",
      description:
        'Most words heard before a command stopped the agent; leading fillers ("okay, stop") count.',
      direction: "lower",
      aggregate: "max",
      unit: "count",
      gate: { mock: 3 },
    },
    {
      name: "words_to_barge_in",
      description: "Words heard before real speech stopped the agent.",
      direction: "lower",
      unit: "count",
    },
  ],
  cases,
  async setup() {
    return undefined;
  },
  async run(_setup, testCase) {
    return play(testCase.input);
  },
  score(_setup, { input, tags }, output) {
    const tag = tags?.[0];
    const scores: Score[] = [
      {
        metric: "turn_outcome",
        value: output.command === input.command ? 1 : 0,
        detail: `expected ${input.command ?? "a reply"}, got ${output.command ?? "a reply"}`,
      },
    ];
    if (tag === "backchannel") {
      scores.push({ metric: "false_interruptions", value: output.interrupted ? 1 : 0 });
    }
    if (tag === "stop" || tag === "cancel") {
      scores.push({
        metric: "command_detection",
        value: output.interrupted && output.command === input.command ? 1 : 0,
      });
      scores.push({ metric: "words_to_stop", value: output.wordsAtInterrupt });
    }
    if (tag === "barge-in") {
      scores.push({ metric: "barge_in_recall", value: output.interrupted ? 1 : 0 });
      scores.push({ metric: "words_to_barge_in", value: output.wordsAtInterrupt });
    }
    if (tag === "listening" && output.interrupted) {
      scores.push({ metric: "false_interruptions", value: 1, detail: "interrupted a quiet agent" });
    }
    return scores;
  },
  describe: (output) =>
    `${output.interrupted ? `interrupted at word ${output.wordsAtInterrupt}` : "carried on"}; turn: ${output.command ?? "reply"}`,
});
