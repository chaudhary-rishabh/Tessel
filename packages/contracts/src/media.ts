import { z } from "zod";
import { pageCursorSchema } from "./paging";

/**
 * Generated media: images (made or edited in chat or the gallery) and
 * videos (made by a background job). Private to the user who made them.
 */

export const IMAGE_ASPECT_RATIOS = ["1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4"] as const;
export const imageAspectRatioSchema = z.enum(IMAGE_ASPECT_RATIOS);
export type ImageAspectRatio = z.infer<typeof imageAspectRatioSchema>;

/** The longest prompt a generation takes. */
export const MEDIA_PROMPT_MAX = 4_000;

export const mediaKindSchema = z.enum(["image", "video"]);
export const mediaStatusSchema = z.enum(["pending", "ready", "failed"]);

export const mediaItemSchema = z.object({
  id: z.uuid(),
  kind: mediaKindSchema,
  status: mediaStatusSchema,
  prompt: z.string(),
  modelId: z.string(),
  /** The chat it was made in, if it still exists. */
  threadId: z.uuid().nullable(),
  /** The images it was made from, for edits. */
  sourceIds: z.array(z.uuid()),
  mediaType: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  sizeBytes: z.number().int().nullable(),
  /** For a job still running, in percent. */
  progress: z.number().int().min(0).max(100),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

export const mediaListQuerySchema = z.object({
  kind: mediaKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: pageCursorSchema.optional(),
});

export const mediaListResponseSchema = z.object({
  items: z.array(mediaItemSchema),
  /** Pass as `before` to load older items; null when there are no more. */
  nextCursor: pageCursorSchema.nullable(),
});
export type MediaListResponse = z.infer<typeof mediaListResponseSchema>;

/** Make an image from a prompt, or edit one (or a few) by naming them as sources. */
export const generateImageRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(MEDIA_PROMPT_MAX),
  /** Defaults to 1:1, or for an edit, the shape of the first source image. */
  aspectRatio: imageAspectRatioSchema.optional(),
  /** Images to edit or combine: generated images or chat attachments. */
  sourceIds: z.array(z.uuid()).max(4).default([]),
});
export type GenerateImageRequest = z.input<typeof generateImageRequestSchema>;

export const mediaStatusResponseSchema = z.object({
  images: z.boolean(),
  videos: z.boolean(),
});
export type MediaStatus = z.infer<typeof mediaStatusResponseSchema>;

/** The allowed aspect ratio closest to an image's shape. */
export function closestAspectRatio(width: number, height: number): ImageAspectRatio {
  const target = Math.log(width / height);
  let best: ImageAspectRatio = "1:1";
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const [w, h] = ratio.split(":").map(Number) as [number, number];
    const [bw, bh] = best.split(":").map(Number) as [number, number];
    if (Math.abs(Math.log(w / h) - target) < Math.abs(Math.log(bw / bh) - target)) best = ratio;
  }
  return best;
}

/** A reference to an image in a message, for edits: written as [image:ID]. */
export const IMAGE_REFERENCE = /\[image:([0-9a-f-]{36})\]/gi;

/** The image IDs a message refers to, in order, and its text without them. */
export function imageReferences(text: string): { ids: string[]; text: string } {
  const ids = [...text.matchAll(IMAGE_REFERENCE)].map((match) => match[1]!.toLowerCase());
  return { ids: [...new Set(ids)], text: text.replace(IMAGE_REFERENCE, "").replace(/^\s+/, "") };
}

export const mediaParamsSchema = z.object({ workspaceId: z.uuid(), mediaId: z.uuid() });
export const mediaContentQuerySchema = z.object({
  variant: z.enum(["original", "preview"]).default("original"),
  download: z.enum(["1", "0"]).optional(),
});
