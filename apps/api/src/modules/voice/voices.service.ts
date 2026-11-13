import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_VOICE_ID,
  selectVoiceRequestSchema,
  STOCK_VOICES,
  type VoiceChallenge,
  type VoiceList,
  type VoiceOption,
} from "@tessel/contracts";
import { userVoices, users, withUserContext, type Database, type Transaction } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { and, asc, eq } from "drizzle-orm";
import type { AuditRecorder } from "../../lib/audit";
import { AppError, errors } from "../../lib/errors";
import type { UsageLimits } from "../billing/usage-limits";
import { workspacesRepository } from "../workspaces/workspaces.repository";
import { VoiceProviderError, type VoiceCloning } from "./elevenlabs";
import type { Actor } from "./voice.service";

/** The passage read to add a voice: about half a minute, with a wide range of sounds. */
export const VOICE_PASSAGE =
  "The quick morning light spread over the hills as we packed the car. " +
  "Jasmine wanted coffee, Theo wanted maps, and I just wanted to be on the road by eight. " +
  "We sang badly, argued about directions, and stopped twice for fresh bread and cherries. " +
  "By noon the sea was in sight, bright and very blue.";

/** Words for the one-time code: short, distinct, and easy to say and to transcribe. */
const CODE_WORDS = [
  "amber",
  "anchor",
  "apple",
  "arrow",
  "basket",
  "beacon",
  "breeze",
  "candle",
  "canyon",
  "carpet",
  "cedar",
  "comet",
  "copper",
  "cotton",
  "crystal",
  "daisy",
  "dolphin",
  "falcon",
  "feather",
  "forest",
  "garden",
  "glacier",
  "harbor",
  "helmet",
  "island",
  "jacket",
  "jungle",
  "kettle",
  "ladder",
  "lantern",
  "lemon",
  "marble",
  "meadow",
  "mirror",
  "orange",
  "orbit",
  "paddle",
  "pebble",
  "pepper",
  "pillow",
  "planet",
  "pocket",
  "rabbit",
  "ribbon",
  "river",
  "rocket",
  "saddle",
  "salmon",
  "silver",
  "spider",
  "summer",
  "sunset",
  "thunder",
  "timber",
  "tunnel",
  "velvet",
  "violin",
  "walnut",
  "window",
  "winter",
  "yellow",
  "zebra",
  "tomato",
  "button",
] as const;

const CODE_LENGTH = 4;
const CHALLENGE_TTL_MS = 10 * 60_000;
export const MIN_RECORDING_SECONDS = 15;
export const MAX_RECORDING_SECONDS = 90;
/** What a voice says when previewed. */
const PREVIEW_TEXT = "Hi, I'm Tessel. This is how I'll sound when we talk.";

const providerIdFor = (voiceId: string) => voiceId.slice("stock:".length);
const stockOption = (voice: (typeof STOCK_VOICES)[number]): VoiceOption => ({
  id: `stock:${voice.providerId}`,
  kind: "stock",
  name: voice.name,
  description: voice.description,
});

/** Lowercase words, without punctuation, for comparing what was asked with what was heard. */
const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Whether the code words were all said, in order. */
export function heardCode(transcript: string, code: string[]): boolean {
  const heard = wordsOf(transcript);
  let position = 0;
  for (const word of code) {
    const found = heard.indexOf(word, position);
    if (found === -1) return false;
    position = found + 1;
  }
  return true;
}

const voiceUnavailable = () =>
  new AppError(503, "own_voice_unavailable", "Adding your own voice isn't set up on this server");

/**
 * The voices Tessel speaks with: a few stock voices, and the user's own,
 * cloned from a recording only after they agreed and read a one-time code
 * (so nobody can clone a recording of someone else). The recording is sent
 * to ElevenLabs and not kept here.
 */
export function createVoicesService({
  db,
  cloning,
  speak,
  limits,
  audit,
  logger,
  secret,
  now = () => Date.now(),
}: {
  db: Database;
  /** ElevenLabs; without it users can't add their own voice. */
  cloning: VoiceCloning | undefined;
  /** Speaks a preview with a provider voice ID; without it there are no previews. */
  speak: ((providerVoiceId: string, text: string) => Promise<Buffer>) | undefined;
  limits?: UsageLimits | undefined;
  audit: AuditRecorder;
  logger: Logger;
  /** Signs the one-time code, so the server needn't store it. */
  secret: string;
  now?: () => number;
}) {
  const sign = (payload: string) =>
    createHmac("sha256", secret).update(`voice-challenge:${payload}`).digest("base64url");

  async function requireMembership(tx: Transaction, actor: Actor) {
    const workspace = await workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId);
    if (!workspace) throw errors.notFound("Workspace not found");
  }

  /** Own voices need ElevenLabs on the server and a paid plan in this workspace. */
  async function ownVoiceAccess(actor: Actor): Promise<VoiceList["ownVoice"]> {
    if (!cloning) return { available: false, reason: "not_configured" };
    if (limits) {
      const plan = limits.effectivePlan(await limits.account(actor.workspaceId));
      if (plan.modelTier === "free") return { available: false, reason: "plan" };
    }
    return { available: true };
  }

  async function ownVoices(tx: Transaction, userId: string) {
    return tx
      .select()
      .from(userVoices)
      .where(eq(userVoices.userId, userId))
      .orderBy(asc(userVoices.createdAt));
  }

  async function findOwn(tx: Transaction, userId: string, id: string) {
    const [row] = await tx
      .select()
      .from(userVoices)
      .where(and(eq(userVoices.id, id), eq(userVoices.userId, userId)));
    return row;
  }

  return {
    async list(actor: Actor): Promise<VoiceList> {
      const access = await ownVoiceAccess(actor);
      return withUserContext(db, actor.userId, async (tx) => {
        await requireMembership(tx, actor);
        const own = await ownVoices(tx, actor.userId);
        const [user] = await tx
          .select({ preference: users.voicePreference })
          .from(users)
          .where(eq(users.id, actor.userId));
        const voices: VoiceOption[] = [
          ...STOCK_VOICES.map(stockOption),
          ...own.map((row) => ({
            id: `own:${row.id}`,
            kind: "own" as const,
            name: row.name,
            description: "Your own voice",
            createdAt: row.createdAt.toISOString(),
          })),
        ];
        const preference = user?.preference ?? DEFAULT_VOICE_ID;
        const selectedId = voices.some((voice) => voice.id === preference)
          ? preference
          : DEFAULT_VOICE_ID;
        return { voices, selectedId, ownVoice: access };
      });
    },

    async select(actor: Actor, input: unknown): Promise<void> {
      const { voiceId } = selectVoiceRequestSchema.parse(input);
      await withUserContext(db, actor.userId, async (tx) => {
        await requireMembership(tx, actor);
        if (voiceId.startsWith("own:")) {
          if (!(await findOwn(tx, actor.userId, voiceId.slice(4))))
            throw errors.notFound("Voice not found");
        } else if (!STOCK_VOICES.some((voice) => voice.providerId === providerIdFor(voiceId))) {
          throw errors.notFound("Voice not found");
        }
        await tx.update(users).set({ voicePreference: voiceId }).where(eq(users.id, actor.userId));
      });
    },

    /** A passage and a one-time code to read aloud, valid for ten minutes. */
    async challenge(actor: Actor): Promise<VoiceChallenge> {
      const access = await ownVoiceAccess(actor);
      if (!access.available) {
        if (access.reason === "plan") {
          throw new AppError(
            403,
            "own_voice_requires_plan",
            "Your own voice needs a paid plan. Upgrade in Settings.",
          );
        }
        throw voiceUnavailable();
      }
      const code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_WORDS[randomInt(CODE_WORDS.length)]!,
      );
      const payload = Buffer.from(
        JSON.stringify({ u: actor.userId, c: code, e: now() + CHALLENGE_TTL_MS }),
      ).toString("base64url");
      return {
        token: `${payload}.${sign(payload)}`,
        passage: VOICE_PASSAGE,
        phrase: `This is my own voice, and my code is ${code.join(" ")}.`,
        minSeconds: MIN_RECORDING_SECONDS,
        maxSeconds: MAX_RECORDING_SECONDS,
      };
    },

    /**
     * Adds the user's voice from their recording of the passage and code. The
     * recording must contain the code, in order, and enough speech to clone.
     * It replaces a voice they added before.
     */
    async create(
      actor: Actor & { ipAddress?: string | undefined },
      input: { token: string; name: string; audio: Buffer; mediaType: string },
    ): Promise<VoiceOption> {
      if (!cloning) throw voiceUnavailable();
      const access = await ownVoiceAccess(actor);
      if (!access.available) {
        throw new AppError(
          403,
          "own_voice_requires_plan",
          "Your own voice needs a paid plan. Upgrade in Settings.",
        );
      }

      // The code they were asked to read, as long as it's theirs and recent.
      const [payload, signature] = input.token.split(".");
      const expected = payload ? sign(payload) : "";
      if (
        !payload ||
        !signature ||
        signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      ) {
        throw errors.badRequest(
          "voice_challenge_invalid",
          "This recording session isn't valid. Start again.",
        );
      }
      const challenge = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
        u: string;
        c: string[];
        e: number;
      };
      if (challenge.u !== actor.userId || challenge.e < now()) {
        throw new AppError(
          400,
          "voice_challenge_expired",
          "This recording session expired. Start again.",
        );
      }

      let heard: { text: string; seconds: number };
      try {
        heard = await cloning.transcribe(input.audio, input.mediaType);
      } catch (error) {
        logger.error({ err: error }, "Couldn't transcribe a voice recording");
        throw new AppError(
          502,
          "voice_provider_error",
          "Your recording couldn't be checked. Try again.",
        );
      }
      if (heard.seconds < MIN_RECORDING_SECONDS) {
        throw new AppError(
          422,
          "voice_recording_too_short",
          `Read the whole passage: we need at least ${MIN_RECORDING_SECONDS} seconds of speech.`,
        );
      }
      if (!heardCode(heard.text, challenge.c)) {
        throw new AppError(
          422,
          "voice_code_not_heard",
          "We couldn't hear your code. Read the last sentence clearly and try again.",
        );
      }

      const phrase = `This is my own voice, and my code is ${challenge.c.join(" ")}.`;
      const name = input.name.trim().slice(0, 60) || "My voice";
      let providerVoiceId: string;
      try {
        providerVoiceId = await cloning.createVoice({
          name: `Tessel ${actor.userId}`,
          description: "A Tessel user's own voice, cloned with their consent",
          audio: input.audio,
          mediaType: input.mediaType,
        });
      } catch (error) {
        logger.error({ err: error }, "Couldn't clone a voice");
        if (error instanceof VoiceProviderError && error.status === 422) {
          throw new AppError(
            422,
            "voice_recording_unusable",
            "That recording couldn't be used. Record somewhere quieter and try again.",
          );
        }
        throw new AppError(502, "voice_provider_error", "Your voice couldn't be added. Try again.");
      }

      const { row, replaced } = await withUserContext(db, actor.userId, async (tx) => {
        await requireMembership(tx, actor);
        const replaced = await tx
          .delete(userVoices)
          .where(eq(userVoices.userId, actor.userId))
          .returning({ id: userVoices.id, providerVoiceId: userVoices.providerVoiceId });
        const [row] = await tx
          .insert(userVoices)
          .values({
            userId: actor.userId,
            providerVoiceId,
            name,
            consentPhrase: phrase,
            consentedAt: new Date(now()),
          })
          .returning();
        // The new voice is the one they'll want to hear.
        await tx
          .update(users)
          .set({ voicePreference: `own:${row!.id}` })
          .where(eq(users.id, actor.userId));
        return { row: row!, replaced };
      });
      for (const old of replaced) {
        cloning
          .deleteVoice(old.providerVoiceId)
          .catch((error: unknown) =>
            logger.warn({ err: error }, "Couldn't delete a replaced voice at ElevenLabs"),
          );
      }
      await audit.record({
        actorId: actor.userId,
        workspaceId: actor.workspaceId,
        action: "voice.added",
        target: `voice:${row.id}`,
        metadata: { replaced: replaced.length },
        ipAddress: actor.ipAddress,
      });
      return {
        id: `own:${row.id}`,
        kind: "own",
        name: row.name,
        description: "Your own voice",
        createdAt: row.createdAt.toISOString(),
      };
    },

    /** Removes the user's voice here and at ElevenLabs. */
    async remove(actor: Actor & { ipAddress?: string | undefined }, id: string): Promise<void> {
      const removed = await withUserContext(db, actor.userId, async (tx) => {
        await requireMembership(tx, actor);
        const [row] = await tx
          .delete(userVoices)
          .where(and(eq(userVoices.id, id), eq(userVoices.userId, actor.userId)))
          .returning();
        if (!row) throw errors.notFound("Voice not found");
        await tx
          .update(users)
          .set({ voicePreference: null })
          .where(and(eq(users.id, actor.userId), eq(users.voicePreference, `own:${id}`)));
        return row;
      });
      if (cloning) {
        await cloning.deleteVoice(removed.providerVoiceId).catch((error: unknown) => {
          // The row is gone, so the voice can't be used; log it for a manual clean-up.
          logger.error(
            { err: error, providerVoiceId: removed.providerVoiceId },
            "Couldn't delete a voice at ElevenLabs",
          );
        });
      }
      await audit.record({
        actorId: actor.userId,
        workspaceId: actor.workspaceId,
        action: "voice.removed",
        target: `voice:${id}`,
        ipAddress: actor.ipAddress,
      });
    },

    /** A few seconds of the voice, as MP3. */
    async preview(actor: Actor, voiceId: string): Promise<Buffer> {
      if (!speak) throw new AppError(503, "voice_preview_unavailable", "Previews aren't available");
      let providerVoiceId: string;
      if (voiceId.startsWith("own:")) {
        const row = await withUserContext(db, actor.userId, (tx) =>
          findOwn(tx, actor.userId, voiceId.slice(4)),
        );
        // A cloned voice lives in our ElevenLabs account, so only ElevenLabs can speak it.
        if (!row || !cloning) throw errors.notFound("Voice not found");
        providerVoiceId = row.providerVoiceId;
      } else {
        providerVoiceId = providerIdFor(voiceId);
        if (!STOCK_VOICES.some((voice) => voice.providerId === providerVoiceId))
          throw errors.notFound("Voice not found");
      }
      try {
        return await speak(providerVoiceId, PREVIEW_TEXT);
      } catch (error) {
        logger.error({ err: error }, "Couldn't speak a voice preview");
        throw new AppError(502, "voice_provider_error", "The preview couldn't play. Try again.");
      }
    },

    /**
     * The provider voice a new conversation speaks with: the user's choice
     * when it's usable here, otherwise the default.
     */
    async voiceForSession(tx: Transaction, actor: Actor): Promise<string> {
      const fallback = providerIdFor(DEFAULT_VOICE_ID);
      const [user] = await tx
        .select({ preference: users.voicePreference })
        .from(users)
        .where(eq(users.id, actor.userId));
      const preference = user?.preference;
      if (!preference) return fallback;
      if (preference.startsWith("stock:")) {
        const id = providerIdFor(preference);
        return STOCK_VOICES.some((voice) => voice.providerId === id) ? id : fallback;
      }
      const row = await findOwn(tx, actor.userId, preference.slice(4));
      if (!row) return fallback;
      const access = await ownVoiceAccess(actor);
      return access.available ? row.providerVoiceId : fallback;
    },
  };
}

export type VoicesService = ReturnType<typeof createVoicesService>;
