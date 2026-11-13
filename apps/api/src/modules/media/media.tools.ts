import { defineTool, ToolError, type ToolDefinition } from "@tessel/ai";
import { IMAGE_ASPECT_RATIOS, MEDIA_PROMPT_MAX, type MediaItem } from "@tessel/contracts";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import type { Actor, MediaService } from "./media.service";

/** Image models can take a minute, longer than other tools. */
const IMAGE_TOOL_TIMEOUT_MS = 180_000;

const aspectRatio = z
  .enum(IMAGE_ASPECT_RATIOS)
  .default("1:1")
  .describe(
    "1:1 unless the user wants another shape: 16:9 or 3:2 for landscape, 9:16 or 2:3 for portrait",
  );

function made(image: MediaItem, verb: string) {
  return {
    content: `${verb} image ${image.id} (${image.width}×${image.height}). The user sees it under your reply, so don't link to it or describe it at length; say briefly what you made. To change it later, call edit_image with image_id "${image.id}".`,
    summary: `${verb} an image`,
    media: [
      {
        kind: "image" as const,
        id: image.id,
        ...(image.width ? { width: image.width } : {}),
        ...(image.height ? { height: image.height } : {}),
        alt: image.prompt.slice(0, 300),
      },
    ],
  };
}

/** Problems the user can act on are reported to the model as written. */
async function asToolError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError && error.status < 500 && error.status !== 429) {
      throw new ToolError(error.message);
    }
    throw error;
  }
}

/** Making and editing images in chat. The images are saved to the user's gallery. */
export function imageTools({
  media,
  actor,
  threadId,
}: {
  media: MediaService;
  actor: Actor;
  threadId: string;
}): ToolDefinition[] {
  if (!media.status().images) return [];

  const generateImage = defineTool({
    name: "generate_image",
    title: "Generate an image",
    description:
      "Make a new image from a description: illustrations, photos, logos, diagrams with little text, and so on. Write a detailed prompt covering the subject, style, composition, lighting, and colours, using what the user asked for. Use it whenever the user asks you to draw, make, design, or picture something visual.",
    schema: z.object({
      prompt: z
        .string()
        .min(1)
        .max(MEDIA_PROMPT_MAX)
        .describe("A detailed description of the image"),
      aspect_ratio: aspectRatio,
    }),
    risk: "read",
    timeoutMs: IMAGE_TOOL_TIMEOUT_MS,
    async run({ prompt, aspect_ratio }, { signal }) {
      const image = await asToolError(() =>
        media.generateImage(actor, { prompt, aspectRatio: aspect_ratio }, { threadId, signal }),
      );
      return made(image, "Generated");
    },
  });

  const editImage = defineTool({
    name: "edit_image",
    title: "Edit an image",
    description:
      "Change an existing image: one you generated earlier in this chat, or one the user attached. Describe the change and what to keep the same. Without image_id it edits the newest image in the chat. Pass several image_ids to combine images.",
    schema: z.object({
      prompt: z
        .string()
        .min(1)
        .max(MEDIA_PROMPT_MAX)
        .describe("The change to make, and what to keep"),
      image_id: z
        .string()
        .uuid()
        .optional()
        .describe("The image to edit; defaults to the newest image in the chat"),
      image_ids: z.array(z.string().uuid()).max(4).optional().describe("Several images to combine"),
      aspect_ratio: z
        .enum(IMAGE_ASPECT_RATIOS)
        .optional()
        .describe("Only to change the shape; by default the edit keeps the image's shape"),
    }),
    risk: "read",
    timeoutMs: IMAGE_TOOL_TIMEOUT_MS,
    async run({ prompt, image_id, image_ids, aspect_ratio }, { signal }) {
      let sourceIds = [...new Set([...(image_id ? [image_id] : []), ...(image_ids ?? [])])];
      if (sourceIds.length === 0) {
        const latest = await media.latestInThread(actor, threadId);
        if (!latest)
          throw new ToolError(
            "There's no image in this chat to edit. Ask the user to attach one, or generate one first.",
          );
        sourceIds = [latest.id];
      }
      const image = await asToolError(() =>
        media.generateImage(
          actor,
          { prompt, sourceIds, ...(aspect_ratio ? { aspectRatio: aspect_ratio } : {}) },
          { threadId, signal },
        ),
      );
      return made(image, "Edited");
    },
  });

  return [generateImage, editImage];
}
