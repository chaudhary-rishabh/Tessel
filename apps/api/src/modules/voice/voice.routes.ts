import {
  ownVoiceParamsSchema,
  voicePreviewParamsSchema,
  voiceSessionParamsSchema,
  workspaceParamsSchema,
} from "@tessel/contracts";
import express, { Router, type Request, type RequestHandler } from "express";
import { errors } from "../../lib/errors";
import { getAuth } from "../../middleware/require-auth";
import {
  createRateLimiter,
  userKey,
  type RateLimitRule,
  type RateLimitStoreFactory,
} from "../../middleware/rate-limit";
import type { Actor, VoiceService } from "./voice.service";
import type { SpeechService } from "./speech.service";
import type { VoicesService } from "./voices.service";

/** Recordings browsers make (MediaRecorder) or people upload. */
const RECORDING_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

/** Routes under /workspaces/:workspaceId/voice. */
export function createVoiceRouter({
  service,
  voices,
  speech,
  authenticate,
  rateLimit,
  storeFactory,
}: {
  service: VoiceService;
  voices: VoicesService;
  speech: SpeechService;
  authenticate: RequestHandler;
  rateLimit: RateLimitRule;
  storeFactory?: RateLimitStoreFactory | undefined;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.get("/status", (_req, res) => {
    res.json({ ...service.status(), ...speech.available() });
  });
  // Starting a conversation calls models for as long as it runs, so it shares the AI limit.
  router.post(
    "/sessions",
    createRateLimiter({ name: "voice", ...rateLimit, storeFactory, key: userKey }),
    async (req, res) => {
      res.status(201).json(await service.start(actorFor(req), req.body));
    },
  );
  router.post("/sessions/:sessionId/end", async (req, res) => {
    const { sessionId } = voiceSessionParamsSchema.parse(req.params);
    await service.end(actorFor(req), sessionId);
    res.status(204).end();
  });

  // A reply read aloud, and dictation into the composer.
  const speechLimiter = createRateLimiter({
    name: "speech",
    ...rateLimit,
    storeFactory,
    key: userKey,
  });
  router.post("/speak", speechLimiter, async (req, res) => {
    const audio = await speech.readAloud(actorFor(req), req.body);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.end(audio);
  });
  router.post(
    "/transcribe",
    speechLimiter,
    express.raw({ type: [...RECORDING_TYPES], limit: "25mb" }),
    async (req, res) => {
      const mediaType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (!RECORDING_TYPES.has(mediaType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw errors.badRequest("voice_recording_missing", "Send the recording as audio.");
      }
      res.json(await speech.dictate(actorFor(req), req.body, mediaType));
    },
  );

  // The voices Tessel speaks with, including the user's own.
  const voiceLimiter = createRateLimiter({
    name: "voices",
    ...rateLimit,
    storeFactory,
    key: userKey,
  });
  router.get("/voices", async (req, res) => {
    res.json(await voices.list(actorFor(req)));
  });
  router.put("/voices/selected", async (req, res) => {
    await voices.select(actorFor(req), req.body);
    res.status(204).end();
  });
  router.post("/voices/challenge", voiceLimiter, async (req, res) => {
    res.json(await voices.challenge(actorFor(req)));
  });
  router.post(
    "/voices",
    voiceLimiter,
    express.raw({ type: [...RECORDING_TYPES], limit: "12mb" }),
    async (req, res) => {
      const mediaType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (!RECORDING_TYPES.has(mediaType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw errors.badRequest("voice_recording_missing", "Send the recording as audio.");
      }
      const token = req.headers["x-voice-challenge"];
      if (typeof token !== "string" || !token) {
        throw errors.badRequest("voice_challenge_invalid", "This recording session isn't valid.");
      }
      const name = typeof req.query.name === "string" ? req.query.name : "";
      res
        .status(201)
        .json(
          await voices.create(
            { ...actorFor(req), ipAddress: req.ip },
            { token, name, audio: req.body, mediaType },
          ),
        );
    },
  );
  router.delete("/voices/:voiceId", async (req, res) => {
    const { voiceId } = ownVoiceParamsSchema.parse(req.params);
    await voices.remove({ ...actorFor(req), ipAddress: req.ip }, voiceId);
    res.status(204).end();
  });
  router.get("/voices/:voiceId/preview", voiceLimiter, async (req, res) => {
    const { voiceId } = voicePreviewParamsSchema.parse(req.params);
    const audio = await voices.preview(actorFor(req), voiceId);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(audio);
  });
  return router;
}
