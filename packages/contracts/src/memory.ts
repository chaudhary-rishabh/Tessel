import { z } from "zod";

export const memorySchema = z.object({
  id: z.uuid(),
  content: z.string(),
  /** chat: noticed after a reply; tool: you asked Tessel to remember; user: added by hand. */
  source: z.enum(["chat", "user", "tool"]),
  sourceThreadId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const memorySettingsSchema = z.object({
  /** Remember facts across chats and use them in replies. */
  memoryEnabled: z.boolean(),
  /** Let Tessel search your earlier chats when you refer to them. */
  chatSearchEnabled: z.boolean(),
});

export const memoryResponseSchema = z.object({
  settings: memorySettingsSchema,
  memories: z.array(memorySchema),
});

const content = z
  .string()
  .trim()
  .min(1, "Write something to remember")
  .max(300, "Keep it under 300 characters");

export const createMemoryRequestSchema = z.object({ content });
export const updateMemoryRequestSchema = z.object({ content });
export const updateMemorySettingsRequestSchema = memorySettingsSchema.partial();

export const memoryParamsSchema = z.object({
  workspaceId: z.uuid("Invalid workspace ID"),
  memoryId: z.uuid("Invalid memory ID"),
});

/** A fact everyone in a team workspace shares, used in every member's replies. */
export const teamMemorySchema = z.object({
  id: z.uuid(),
  content: z.string(),
  /** Who wrote it; null once they've left Tessel. */
  authorName: z.string().nullable(),
  mine: z.boolean(),
  /** The author, owners, and admins can change or delete it. */
  canEdit: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const teamMemoryListResponseSchema = z.object({ memories: z.array(teamMemorySchema) });

export type Memory = z.infer<typeof memorySchema>;
export type TeamMemory = z.infer<typeof teamMemorySchema>;
export type MemorySettings = z.infer<typeof memorySettingsSchema>;
export type MemoryResponse = z.infer<typeof memoryResponseSchema>;
export type UpdateMemorySettingsRequest = z.infer<typeof updateMemorySettingsRequestSchema>;
