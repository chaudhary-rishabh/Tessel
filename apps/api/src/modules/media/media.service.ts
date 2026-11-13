import { randomUUID } from "node:crypto";
import {
  AiError,
  ContentBlockedError,
  type Ai,
  type ImageGenerator,
  type VideoGenerator,
} from "@tessel/ai";
import {
  closestAspectRatio,
  generateImageRequestSchema,
  generateVideoRequestSchema,
  mediaListQuerySchema,
  type MediaItem,
  type MediaListResponse,
} from "@tessel/contracts";
import {
  attachments,
  encodeCursor,
  media,
  messages,
  newestFirst,
  olderThan,
  withUserContext,
  type Database,
  type MediaRow,
  type Transaction,
} from "@tessel/db";
import type { Logger } from "@tessel/logger";
import type { MediaQueue } from "@tessel/queue";
import { and, desc, eq } from "drizzle-orm";
import { storageKeys, type ObjectStore } from "@tessel/storage";
import sharp from "sharp";
import { AppError, errors } from "../../lib/errors";
import type { UsageLimits } from "../billing/usage-limits";
import { workspacesRepository } from "../workspaces/workspaces.repository";

export interface Actor {
  workspaceId: string;
  userId: string;
  requestId?: string | undefined;
}

/** Edits go to the model at most this size on their longest side. */
const SOURCE_MAX_SIDE = 2048;
/** Gallery previews fit in this square. */
const PREVIEW_SIDE = 512;

const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function toMediaItem(row: MediaRow): MediaItem {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    prompt: row.prompt,
    modelId: row.modelId,
    threadId: row.threadId,
    sourceIds: row.sourceIds,
    mediaType: row.mediaType,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    sizeBytes: row.sizeBytes,
    progress: row.progress,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

const imagesUnavailable = () =>
  new AppError(503, "images_unavailable", "Image generation isn't set up");

/**
 * Generated images and videos: making and editing images (from chat tools
 * or the gallery), the gallery list, files, and deleting. Every generation
 * goes through the plan's limits and the daily caps, and lands in the
 * usage ledger as feature "image".
 */
export function createMediaService({
  db,
  ai,
  objects,
  images,
  videos,
  limits,
  logger,
}: {
  db: Database;
  ai: Ai;
  objects: ObjectStore;
  /** The gateway's image model; image generation is off without it. */
  images?: ImageGenerator | undefined;
  /** The gateway's video model and the queue the worker checks videos from; both needed. */
  videos?: { generator: VideoGenerator; queue: MediaQueue } | undefined;
  limits?: UsageLimits | undefined;
  logger: Logger;
}) {
  async function requireMembership(tx: Transaction, actor: Actor) {
    const workspace = await workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId);
    if (!workspace) throw errors.notFound("Workspace not found");
  }

  async function findOwn(tx: Transaction, actor: Actor, id: string) {
    const [row] = await tx
      .select()
      .from(media)
      .where(
        and(
          eq(media.id, id),
          eq(media.workspaceId, actor.workspaceId),
          eq(media.userId, actor.userId),
        ),
      );
    return row;
  }

  /** The bytes of an image to edit: one the user generated, or an image they attached in chat. */
  async function sourceImage(tx: Transaction, actor: Actor, id: string): Promise<Buffer> {
    const generated = await findOwn(tx, actor, id);
    if (generated?.kind === "image" && generated.status === "ready" && generated.storageKey) {
      return objects.get(generated.storageKey);
    }
    const [attachment] = await tx
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.id, id),
          eq(attachments.workspaceId, actor.workspaceId),
          eq(attachments.userId, actor.userId),
        ),
      );
    if (attachment?.kind === "image") return objects.get(attachment.storageKey);
    throw errors.badRequest("image_not_found", `There's no image with ID ${id} to edit.`);
  }

  const asPng = (bytes: Buffer) =>
    sharp(bytes, { animated: false })
      .rotate()
      .resize({
        width: SOURCE_MAX_SIDE,
        height: SOURCE_MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();

  return {
    status() {
      return { images: Boolean(images), videos: Boolean(videos) };
    },

    /**
     * Makes an image from a prompt, or edits the source images. The prompt
     * from the gallery is moderated here; in chat, the user's message was.
     */
    async generateImage(
      actor: Actor,
      input: unknown,
      options: { threadId?: string; moderate?: boolean; signal?: AbortSignal } = {},
    ): Promise<MediaItem> {
      const request = generateImageRequestSchema.parse(input);
      if (!images) throw imagesUnavailable();
      const sources = await withUserContext(db, actor.userId, async (tx) => {
        await requireMembership(tx, actor);
        return Promise.all(request.sourceIds.map((id) => sourceImage(tx, actor, id)));
      });
      if (limits) await limits.check(actor, "free");
      await ai.spend.assertWithinBudget(actor);
      if (options.moderate) {
        const verdict = await ai.moderator.check({ ...actor, feature: "image" }, request.prompt);
        if (!verdict.allowed) throw new ContentBlockedError(verdict.categories);
      }

      const startedAt = Date.now();
      const record = (event: {
        costNanoUsd: number;
        inputTokens: number;
        outputTokens: number;
        status: "ok" | "error";
        errorCode?: string;
      }) =>
        ai.tracker.record({
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          requestId: actor.requestId ?? null,
          feature: "image",
          route: "gateway",
          modelId: images.modelId,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          estimated: false,
          status: event.status,
          errorCode: event.errorCode ?? null,
          costNanoUsd: event.costNanoUsd,
          latencyMs: Date.now() - startedAt,
        });

      const pngs = await Promise.all(sources.map(asPng));
      let aspectRatio = request.aspectRatio ?? "1:1";
      if (!request.aspectRatio && pngs[0]) {
        const { width, height } = await sharp(pngs[0]).metadata();
        if (width && height) aspectRatio = closestAspectRatio(width, height);
      }
      let generated: Awaited<ReturnType<ImageGenerator["generate"]>>;
      try {
        generated = await images.generate({
          prompt: request.prompt,
          aspectRatio,
          sources: pngs,
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        await record({
          costNanoUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          status: "error",
          errorCode: "image_failed",
        });
        logger.warn({ err: error }, "Image generation failed");
        const reason = error instanceof Error ? error.message : "";
        // A refusal says why; anything else stays in the logs.
        if (/safety|moderation|policy|rejected/i.test(reason)) {
          throw new AppError(
            422,
            "image_refused",
            "The image model declined this prompt. Try describing it differently.",
          );
        }
        if (error instanceof AiError) throw error;
        throw new AppError(502, "image_failed", "The image couldn't be made. Try again.");
      }
      await record({ ...generated, status: "ok" });
      const bytes = generated.images[0];
      if (!bytes)
        throw new AppError(502, "image_failed", "The image model returned nothing. Try again.");

      const id = randomUUID();
      const original = Buffer.from(bytes);
      const metadata = await sharp(original).metadata();
      const mediaType = MEDIA_TYPES[metadata.format ?? ""] ?? "image/png";
      const preview = await sharp(original)
        .resize({
          width: PREVIEW_SIDE,
          height: PREVIEW_SIDE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();
      const storageKey = storageKeys.mediaOriginal(actor.workspaceId, id);
      const previewKey = storageKeys.mediaPreview(actor.workspaceId, id);
      // Bytes first: a row never points at a file that isn't there.
      await Promise.all([
        objects.put(storageKey, original, mediaType),
        objects.put(previewKey, preview, "image/webp"),
      ]);
      const [row] = await withUserContext(db, actor.userId, (tx) =>
        tx
          .insert(media)
          .values({
            id,
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            threadId: options.threadId ?? null,
            kind: "image",
            status: "ready",
            prompt: request.prompt,
            modelId: images.modelId,
            sourceIds: request.sourceIds,
            mediaType,
            width: metadata.width ?? null,
            height: metadata.height ?? null,
            sizeBytes: original.length,
            storageKey,
            previewKey,
            progress: 100,
            costNanoUsd: generated.costNanoUsd,
          })
          .returning(),
      );
      return toMediaItem(row!);
    },

    /**
     * Starts a video: a paid-plan feature, since a few seconds cost about a
     * dollar. The model works in the background; the worker checks on it and
     * saves it, and the row says how far along it is.
     */
    async startVideo(
      actor: Actor,
      input: unknown,
      options: { threadId?: string; moderate?: boolean } = {},
    ): Promise<MediaItem> {
      const request = generateVideoRequestSchema.parse(input);
      if (!videos) throw new AppError(503, "videos_unavailable", "Video generation isn't set up");
      const source = await withUserContext(db, actor.userId, async (tx) => {
        await requireMembership(tx, actor);
        return request.sourceId ? sourceImage(tx, actor, request.sourceId) : undefined;
      });
      if (limits) {
        const plan = limits.effectivePlan(await limits.account(actor.workspaceId));
        if (plan.modelTier === "free") {
          throw errors.forbidden(
            "Making videos needs a paid plan. Upgrade in Settings.",
            "video_requires_plan",
          );
        }
        await limits.check(actor, "pro");
      }
      await ai.spend.assertWithinBudget(actor);
      if (options.moderate) {
        const verdict = await ai.moderator.check({ ...actor, feature: "video" }, request.prompt);
        if (!verdict.allowed) throw new ContentBlockedError(verdict.categories);
      }

      let operation: unknown;
      try {
        ({ operation } = await videos.generator.start({
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          durationSeconds: request.durationSeconds,
          ...(source ? { image: await asPng(source) } : {}),
        }));
      } catch (error) {
        logger.warn({ err: error }, "Couldn't start a video");
        if (error instanceof AiError) throw error;
        throw new AppError(502, "video_failed", "The video couldn't be started. Try again.");
      }
      const landscape = request.aspectRatio === "16:9";
      const [row] = await withUserContext(db, actor.userId, (tx) =>
        tx
          .insert(media)
          .values({
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            threadId: options.threadId ?? null,
            kind: "video",
            status: "pending",
            prompt: request.prompt,
            modelId: videos.generator.modelId,
            sourceIds: request.sourceId ? [request.sourceId] : [],
            mediaType: "video/mp4",
            width: landscape ? 1280 : 720,
            height: landscape ? 720 : 1280,
            durationMs: request.durationSeconds * 1000,
            operation,
          })
          .returning(),
      );
      await videos.queue.enqueueVideo(
        { workspaceId: actor.workspaceId, userId: actor.userId, mediaId: row!.id },
        2_000,
      );
      return toMediaItem(row!);
    },

    /** The newest image in a chat, generated or attached, for "edit that". */
    async latestInThread(actor: Actor, threadId: string): Promise<{ id: string; at: Date } | null> {
      return withUserContext(db, actor.userId, async (tx) => {
        const [generated] = await tx
          .select({ id: media.id, at: media.createdAt })
          .from(media)
          .where(
            and(
              eq(media.threadId, threadId),
              eq(media.userId, actor.userId),
              eq(media.kind, "image"),
            ),
          )
          .orderBy(desc(media.createdAt))
          .limit(1);
        const [attached] = await tx
          .select({ id: attachments.id, at: attachments.createdAt })
          .from(attachments)
          .innerJoin(messages, eq(messages.id, attachments.messageId))
          .where(
            and(
              eq(messages.threadId, threadId),
              eq(attachments.userId, actor.userId),
              eq(attachments.kind, "image"),
            ),
          )
          .orderBy(desc(attachments.createdAt))
          .limit(1);
        if (generated && attached) return generated.at >= attached.at ? generated : attached;
        return generated ?? attached ?? null;
      });
    },

    async list(actor: Actor, query: unknown): Promise<MediaListResponse> {
      const { kind, limit, before } = mediaListQuerySchema.parse(query ?? {});
      const rows = await withUserContext(db, actor.userId, async (tx) => {
        await requireMembership(tx, actor);
        return tx
          .select()
          .from(media)
          .where(
            and(
              eq(media.workspaceId, actor.workspaceId),
              eq(media.userId, actor.userId),
              kind ? eq(media.kind, kind) : undefined,
              before ? olderThan(media.createdAt, media.id, before) : undefined,
            ),
          )
          .orderBy(...newestFirst(media.createdAt, media.id))
          .limit(limit + 1);
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toMediaItem),
        nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    },

    async get(actor: Actor, id: string): Promise<MediaItem> {
      const row = await withUserContext(db, actor.userId, (tx) => findOwn(tx, actor, id));
      if (!row) throw errors.notFound("Not found");
      return toMediaItem(row);
    },

    /** The file, or its small preview. */
    async file(
      actor: Actor,
      id: string,
      variant: "original" | "preview",
    ): Promise<{ data: Buffer; mediaType: string; filename: string }> {
      const row = await withUserContext(db, actor.userId, (tx) => findOwn(tx, actor, id));
      const key = variant === "preview" ? (row?.previewKey ?? row?.storageKey) : row?.storageKey;
      if (!row || !key || row.status !== "ready") throw errors.notFound("Not found");
      const mediaType =
        variant === "preview" && row.previewKey
          ? "image/webp"
          : (row.mediaType ?? "application/octet-stream");
      const extension =
        Object.entries(MEDIA_TYPES).find(([, type]) => type === mediaType)?.[0] ??
        (row.kind === "video" ? "mp4" : "png");
      return {
        data: await objects.get(key),
        mediaType,
        filename: `tessel-${row.kind}-${row.id.slice(0, 8)}.${extension}`,
      };
    },

    async remove(actor: Actor, id: string): Promise<void> {
      const row = await withUserContext(db, actor.userId, async (tx) => {
        const found = await findOwn(tx, actor, id);
        if (found) await tx.delete(media).where(eq(media.id, id));
        return found;
      });
      if (!row) throw errors.notFound("Not found");
      await objects
        .deletePrefix(storageKeys.mediaPrefix(actor.workspaceId, id))
        .catch((error: unknown) => {
          logger.warn({ err: error, mediaId: id }, "Couldn't delete a media file");
        });
    },
  };
}

export type MediaService = ReturnType<typeof createMediaService>;
