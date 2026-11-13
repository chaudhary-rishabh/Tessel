import { z } from "zod";

export const MAX_SKILL_INSTRUCTIONS = 20_000;

/** A skill the agent can load: built in, or written by someone in the workspace. */
export const skillSchema = z.object({
  /** A UUID for workspace skills, "builtin:<name>" for built-in ones. */
  id: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  instructions: z.string(),
  builtIn: z.boolean(),
  enabled: z.boolean(),
  /** The author, for workspace skills. */
  author: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** Whether the signed-in user can edit or delete it. */
  canEdit: z.boolean(),
  /** Reference files and templates that come with it. */
  files: z.array(z.object({ path: z.string(), sizeBytes: z.number().int() })).default([]),
  updatedAt: z.iso.datetime().nullable(),
});

export const skillListResponseSchema = z.object({ skills: z.array(skillSchema) });

const title = z
  .string()
  .trim()
  .min(1, "Give the skill a name")
  .max(80, "Keep the name under 80 characters");
const description = z
  .string()
  .trim()
  .min(10, "Say when to use it, in at least a few words")
  .max(300, "Keep the description under 300 characters");
const instructions = z
  .string()
  .trim()
  .min(10, "Write the instructions")
  .max(MAX_SKILL_INSTRUCTIONS, "Keep the instructions under 20,000 characters");

export const createSkillRequestSchema = z.object({ title, description, instructions });

export const updateSkillRequestSchema = z
  .object({ title, description, instructions, enabled: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");

export const skillParamsSchema = z.object({
  workspaceId: z.uuid("Invalid workspace ID"),
  /** A workspace skill's UUID, or "builtin:<name>" to turn a built-in one on or off. */
  skillId: z.union([z.uuid("Invalid skill ID"), z.string().regex(/^builtin:[a-z0-9-]{1,80}$/)]),
});

export type Skill = z.infer<typeof skillSchema>;
export type SkillListResponse = z.infer<typeof skillListResponseSchema>;
export type CreateSkillRequest = z.infer<typeof createSkillRequestSchema>;
export type UpdateSkillRequest = z.infer<typeof updateSkillRequestSchema>;

/** The most text one skill file holds, and how many a skill can have. */
export const MAX_SKILL_FILE_BYTES = 100 * 1024;
export const MAX_SKILL_FILES = 20;

export const skillFileRequestSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[\w.-]+(\/[\w.-]+)*$/, "Use a path like templates/report.md")
    .refine((path) => !path.split("/").some((part) => part === ".." || part === "."), {
      message: "Use a path like templates/report.md",
    }),
  content: z.string().min(1, "The file is empty"),
});

export const skillFileParamsSchema = z.object({
  workspaceId: z.uuid(),
  skillId: z.uuid(),
});

export const skillFileResponseSchema = z.object({ path: z.string(), content: z.string() });
