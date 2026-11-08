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

export type Memory = z.infer<typeof memorySchema>;
export type MemorySettings = z.infer<typeof memorySettingsSchema>;
export type MemoryResponse = z.infer<typeof memoryResponseSchema>;
export type UpdateMemorySettingsRequest = z.infer<typeof updateMemorySettingsRequestSchema>;
