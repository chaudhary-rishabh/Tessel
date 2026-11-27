import { EventEmitter } from "node:events";
import { voice } from "@livekit/agents";
import { describe, expect, it } from "vitest";
import {
  attachTurnTaking,
  classifyUtterance,
  contentWords,
  interruptionFor,
  type TurnTakingSession,
} from "./turn-taking";

describe("classifyUtterance", () => {
  it.each([
    "mm-hmm",
    "Mhm.",
    "yeah",
    "Yeah, yeah.",
    "okay",
    "right, right",
    "uh huh",
    "I see",
    "got it",
    "haan",
    "haan ji",
    "achha",
    "theek hai",
    "हाँ",
    "ठीक है",
    "Sí.",
  ])("hears %j as a backchannel", (text) => {
    expect(classifyUtterance(text)).toBe("backchannel");
  });

  it.each([
    "stop",
    "Stop!",
    "wait",
    "wait, wait",
    "hold on",
    "no, stop please",
    "okay stop",
    "one second",
    "shh",
    "ruko",
    "bas",
    "bas karo",
    "रुको",
    "espera",
  ])("hears %j as stop", (text) => {
    expect(classifyUtterance(text)).toBe("stop");
  });

  it.each([
    "never mind",
    "Nevermind.",
    "cancel that",
    "forget it",
    "no, forget it",
    "actually, never mind",
    "scratch that",
    "don't do that",
    "wait, cancel",
    "rehne do",
    "chhodo",
    "छोड़ दो",
  ])("hears %j as cancel", (text) => {
    expect(classifyUtterance(text)).toBe("cancel");
  });

  it.each([
    "what about the travel policy",
    "stop the meeting at five",
    "wait, what does that mean",
    "can you cancel my flight to Delhi",
    "yeah but what about Mei",
    "okay so how much is the per diem",
    "no",
    "sure, send it to Priya",
  ])("hears %j as speech", (text) => {
    expect(classifyUtterance(text)).toBe("speech");
  });

  it("hears nothing in silence or noise", () => {
    expect(classifyUtterance("")).toBe("empty");
    expect(classifyUtterance(" ... ")).toBe("empty");
  });

  it("counts content words, not fillers", () => {
    expect(contentWords("um, okay, what about Beacon")).toBe(3);
    expect(contentWords("yeah yeah")).toBe(0);
  });
});

/** A session that only emits events and records interruptions. */
function fakeSession() {
  const events = new EventEmitter();
  let interruptions = 0;
  const session: TurnTakingSession = {
    on: ((event: string, listener: (payload: never) => void) =>
      events.on(event, listener as (...args: unknown[]) => void)) as TurnTakingSession["on"],
    interrupt: () => {
      interruptions += 1;
      return { await: Promise.resolve() };
    },
  };
  const logger = { debug: () => undefined };
  return {
    session,
    logger,
    get interruptions() {
      return interruptions;
    },
    agent: (newState: string) =>
      events.emit(voice.AgentSessionEventTypes.AgentStateChanged, { newState }),
    userStarts: () =>
      events.emit(voice.AgentSessionEventTypes.UserStateChanged, { newState: "speaking" }),
    hears: (transcript: string, isFinal = false) =>
      events.emit(voice.AgentSessionEventTypes.UserInputTranscribed, { transcript, isFinal }),
  };
}

describe("attachTurnTaking", () => {
  it("carries on through a backchannel and ignores it as a turn", () => {
    const fake = fakeSession();
    const turns = attachTurnTaking(fake.session, { minWords: 2, logger: fake.logger });
    fake.agent("speaking");
    fake.userStarts();
    fake.hears("mm");
    fake.hears("mm-hmm", true);
    expect(fake.interruptions).toBe(0);
    expect(turns.stats.backchannels).toBe(1);
    fake.agent("listening");
    expect(turns.commandFor("mm-hmm")).toBe("ignore");
  });

  it("stops at once on a spoken stop, before the final transcript", () => {
    const fake = fakeSession();
    const turns = attachTurnTaking(fake.session, { minWords: 2, logger: fake.logger });
    fake.agent("speaking");
    fake.userStarts();
    fake.hears("stop");
    expect(fake.interruptions).toBe(1);
    fake.hears("stop", true);
    expect(fake.interruptions).toBe(1);
    expect(turns.commandFor("stop")).toBe("stop");
    expect(turns.stats.stops).toBe(1);
  });

  it("cancels a lookup in progress while the agent is thinking", () => {
    const fake = fakeSession();
    const turns = attachTurnTaking(fake.session, { minWords: 2, logger: fake.logger });
    fake.agent("thinking");
    fake.userStarts();
    fake.hears("never mind", true);
    expect(fake.interruptions).toBe(1);
    expect(turns.commandFor("never mind")).toBe("cancel");
  });

  it("interrupts for real speech once it has enough words", () => {
    const fake = fakeSession();
    const turns = attachTurnTaking(fake.session, { minWords: 2, logger: fake.logger });
    fake.agent("speaking");
    fake.userStarts();
    fake.hears("um");
    fake.hears("um what");
    expect(fake.interruptions).toBe(0);
    fake.hears("um what about");
    expect(fake.interruptions).toBe(1);
    fake.hears("um what about the travel policy", true);
    expect(fake.interruptions).toBe(1);
    expect(turns.commandFor("um what about the travel policy")).toBeUndefined();
  });

  it("interrupts when a backchannel turns into a question", () => {
    const fake = fakeSession();
    attachTurnTaking(fake.session, { minWords: 2, logger: fake.logger });
    fake.agent("speaking");
    fake.userStarts();
    fake.hears("yeah", true);
    expect(fake.interruptions).toBe(0);
    fake.hears("but why", true);
    expect(fake.interruptions).toBe(1);
  });

  it("leaves turns alone while the agent is listening", () => {
    const fake = fakeSession();
    const turns = attachTurnTaking(fake.session, { minWords: 2, logger: fake.logger });
    fake.agent("listening");
    fake.userStarts();
    fake.hears("okay", true);
    expect(fake.interruptions).toBe(0);
    // "okay" answering the agent's question is a real reply.
    expect(turns.commandFor("okay")).toBeUndefined();
    expect(turns.commandFor("stop")).toBe("stop");
  });

  it("survives a reply that can't be interrupted", () => {
    const fake = fakeSession();
    fake.session.interrupt = () => {
      throw new Error("This speech handle does not allow interruptions");
    };
    attachTurnTaking(fake.session, { minWords: 2, logger: fake.logger });
    fake.agent("speaking");
    fake.userStarts();
    expect(() => fake.hears("stop")).not.toThrow();
  });
});

describe("interruptionFor", () => {
  it("turns the session's own interruption off in smart mode", () => {
    const smart = interruptionFor("smart");
    expect(smart.minWords).toBe(Number.MAX_SAFE_INTEGER);
    expect(smart.resumeFalseInterruption).toBe(false);
    expect(smart.discardAudioIfUninterruptible).toBe(false);
  });

  it("keeps pause-and-resume in vad mode", () => {
    expect(interruptionFor("vad")).toMatchObject({ resumeFalseInterruption: true });
  });
});
