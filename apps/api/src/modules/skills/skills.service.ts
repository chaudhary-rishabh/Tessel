import { builtInSkills, skillName, type Ai, type SkillDefinition } from "@tessel/ai";
import {
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_FILES,
  skillFileRequestSchema,
  createSkillRequestSchema,
  updateSkillRequestSchema,
  type Skill,
  type WorkspaceRole,
} from "@tessel/contracts";
import {
  skillFiles,
  skills,
  users,
  workspacePolicies,
  withUserContext,
  type Database,
  type SkillRow,
  type Transaction,
} from "@tessel/db";
import { and, asc, eq } from "drizzle-orm";
import { errors, isUniqueViolation } from "../../lib/errors";
import { workspacesRepository } from "../workspaces/workspaces.repository";

export interface Actor {
  userId: string;
  workspaceId: string;
  requestId?: string;
}

/** Row-level security enforces the same rule in Postgres. */
const canEdit = (role: WorkspaceRole, authorId: string, userId: string) =>
  authorId === userId || role === "owner" || role === "admin";

/** Built-in names are reserved, so a workspace skill never shadows one. */
const RESERVED = new Set(builtInSkills.map((skill) => skill.name));

function builtIn(skill: SkillDefinition, enabled = true, canToggle = false): Skill {
  return {
    id: `builtin:${skill.name}`,
    name: skill.name,
    title: skill.title,
    description: skill.description,
    instructions: skill.instructions,
    builtIn: true,
    enabled,
    files: [],
    author: null,
    // Owners and admins can turn a built-in skill on or off, but not change it.
    canEdit: canToggle,
    updatedAt: null,
  };
}

/**
 * Built-in skills and the workspace's own. Members can write skills; the
 * author, owners, and admins can change them. Text is moderated on save,
 * since the agent follows it.
 */
export function createSkillsService({ db, ai }: { db: Database; ai: Ai }) {
  async function membership(tx: Transaction, actor: Actor) {
    const workspace = await workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId);
    if (!workspace) throw errors.notFound("Workspace not found");
    return workspace;
  }

  async function disabledBuiltIns(tx: Transaction, workspaceId: string): Promise<Set<string>> {
    const [row] = await tx
      .select({ disabled: workspacePolicies.disabledSkills })
      .from(workspacePolicies)
      .where(eq(workspacePolicies.workspaceId, workspaceId));
    return new Set(row?.disabled ?? []);
  }

  async function rows(tx: Transaction, workspaceId: string) {
    return tx
      .select({ skill: skills, authorName: users.name })
      .from(skills)
      .innerJoin(users, eq(users.id, skills.userId))
      .where(eq(skills.workspaceId, workspaceId))
      .orderBy(asc(skills.title));
  }

  /** Each skill's files in a workspace, by skill. */
  async function filesBySkill(tx: Transaction, workspaceId: string) {
    const files = await tx
      .select()
      .from(skillFiles)
      .where(eq(skillFiles.workspaceId, workspaceId))
      .orderBy(asc(skillFiles.path));
    const map = new Map<string, { path: string; content: string }[]>();
    for (const file of files) {
      map.set(file.skillId, [
        ...(map.get(file.skillId) ?? []),
        { path: file.path, content: file.content },
      ]);
    }
    return map;
  }

  const toSkill = (
    row: SkillRow,
    authorName: string,
    role: WorkspaceRole,
    userId: string,
    files: { path: string; content: string }[] = [],
  ): Skill => ({
    files: files.map((file) => ({ path: file.path, sizeBytes: Buffer.byteLength(file.content) })),
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    builtIn: false,
    enabled: row.enabled,
    author: { id: row.userId, name: authorName },
    canEdit: canEdit(role, row.userId, userId),
    updatedAt: row.updatedAt.toISOString(),
  });

  async function moderate(actor: Actor, text: string) {
    const result = await ai.moderator.check(
      {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        feature: "moderation",
        ...(actor.requestId ? { requestId: actor.requestId } : {}),
      },
      text,
    );
    if (!result.allowed) {
      throw errors.badRequest(
        "content_blocked",
        "This skill can't be saved because it breaks the usage policy",
      );
    }
  }

  function nameFor(title: string) {
    const name = skillName(title);
    if (!name) throw errors.badRequest("invalid_name", "Use letters or numbers in the name");
    if (RESERVED.has(name)) {
      throw errors.conflict("skill_name_taken", "A built-in skill already has this name");
    }
    return name;
  }

  const taken = () =>
    errors.conflict("skill_name_taken", "Another skill in this workspace has this name");

  /** Owners and admins turn built-in skills on or off for the workspace; nothing else changes. */
  async function toggleBuiltIn(
    actor: Actor,
    name: string,
    request: { enabled?: boolean | undefined; title?: string | undefined },
  ): Promise<Skill> {
    const skill = builtInSkills.find((item) => item.name === name);
    if (!skill) throw errors.notFound("Skill not found");
    if (request.enabled === undefined || Object.keys(request).length > 1) {
      throw errors.badRequest("built_in_skill", "Built-in skills can only be turned on or off");
    }
    return withUserContext(db, actor.userId, async (tx) => {
      const workspace = await membership(tx, actor);
      if (workspace.role !== "owner" && workspace.role !== "admin") {
        throw errors.forbidden("Only owners and admins can turn built-in skills on or off");
      }
      const disabled = await disabledBuiltIns(tx, actor.workspaceId);
      if (request.enabled) disabled.delete(name);
      else disabled.add(name);
      const value = [...disabled];
      await tx
        .insert(workspacePolicies)
        .values({ workspaceId: actor.workspaceId, disabledSkills: value, updatedBy: actor.userId })
        .onConflictDoUpdate({
          target: workspacePolicies.workspaceId,
          set: { disabledSkills: value, updatedBy: actor.userId },
        });
      return builtIn(skill, request.enabled!, true);
    });
  }

  /** A workspace skill the user can change (author, owners, admins). */
  async function editableSkill(tx: Transaction, actor: Actor, skillId: string) {
    const workspace = await membership(tx, actor);
    const [current] = await tx
      .select()
      .from(skills)
      .where(and(eq(skills.id, skillId), eq(skills.workspaceId, actor.workspaceId)));
    if (!current) throw errors.notFound("Skill not found");
    if (!canEdit(workspace.role, current.userId, actor.userId)) {
      throw errors.forbidden("Only the author, owners, and admins can change this skill");
    }
    return current;
  }

  return {
    /** Adds a file to a skill, or replaces the one at that path. The text is moderated. */
    async putFile(
      actor: Actor,
      skillId: string,
      input: unknown,
    ): Promise<{ path: string; sizeBytes: number }> {
      const { path, content } = skillFileRequestSchema.parse(input);
      const sizeBytes = Buffer.byteLength(content);
      if (sizeBytes > MAX_SKILL_FILE_BYTES) {
        throw errors.badRequest("file_too_large", "Skill files can be up to 100 KB");
      }
      await withUserContext(db, actor.userId, (tx) => editableSkill(tx, actor, skillId));
      await moderate(actor, content);
      await withUserContext(db, actor.userId, async (tx) => {
        await editableSkill(tx, actor, skillId);
        const existing = await tx
          .select({ path: skillFiles.path })
          .from(skillFiles)
          .where(eq(skillFiles.skillId, skillId));
        if (!existing.some((file) => file.path === path) && existing.length >= MAX_SKILL_FILES) {
          throw errors.badRequest(
            "too_many_files",
            `A skill can have up to ${MAX_SKILL_FILES} files`,
          );
        }
        await tx
          .insert(skillFiles)
          .values({ skillId, workspaceId: actor.workspaceId, path, content })
          .onConflictDoUpdate({ target: [skillFiles.skillId, skillFiles.path], set: { content } });
      });
      return { path, sizeBytes };
    },

    async readFile(actor: Actor, skillId: string, path: string) {
      const [file] = await withUserContext(db, actor.userId, async (tx) => {
        await membership(tx, actor);
        return tx
          .select()
          .from(skillFiles)
          .where(
            and(
              eq(skillFiles.skillId, skillId),
              eq(skillFiles.workspaceId, actor.workspaceId),
              eq(skillFiles.path, path),
            ),
          );
      });
      if (!file) throw errors.notFound("File not found");
      return { path: file.path, content: file.content };
    },

    async removeFile(actor: Actor, skillId: string, path: string): Promise<void> {
      const removed = await withUserContext(db, actor.userId, async (tx) => {
        await editableSkill(tx, actor, skillId);
        return tx
          .delete(skillFiles)
          .where(and(eq(skillFiles.skillId, skillId), eq(skillFiles.path, path)))
          .returning({ id: skillFiles.id });
      });
      if (removed.length === 0) throw errors.notFound("File not found");
    },

    async list(actor: Actor): Promise<Skill[]> {
      return withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, actor);
        const files = await filesBySkill(tx, actor.workspaceId);
        const own = (await rows(tx, actor.workspaceId)).map(({ skill, authorName }) =>
          toSkill(skill, authorName, workspace.role, actor.userId, files.get(skill.id)),
        );
        const disabled = await disabledBuiltIns(tx, actor.workspaceId);
        const admin = workspace.role === "owner" || workspace.role === "admin";
        return [
          ...own,
          ...builtInSkills.map((skill) => builtIn(skill, !disabled.has(skill.name), admin)),
        ];
      });
    },

    /** The skills the agent may load in this workspace. */
    async forAgent(actor: Actor): Promise<SkillDefinition[]> {
      const { own, disabled, files } = await withUserContext(db, actor.userId, async (tx) => ({
        files: await filesBySkill(tx, actor.workspaceId),
        own: await tx
          .select()
          .from(skills)
          .where(and(eq(skills.workspaceId, actor.workspaceId), eq(skills.enabled, true)))
          .orderBy(asc(skills.title)),
        disabled: await disabledBuiltIns(tx, actor.workspaceId),
      }));
      return [
        ...own.map((row) => ({
          name: row.name,
          title: row.title,
          description: row.description,
          instructions: row.instructions,
          builtIn: false,
          files: files.get(row.id) ?? [],
        })),
        ...builtInSkills.filter((skill) => !disabled.has(skill.name)),
      ];
    },

    async create(actor: Actor, input: unknown): Promise<Skill> {
      const request = createSkillRequestSchema.parse(input);
      const name = nameFor(request.title);
      // Membership first: moderation is a paid call, so only members can trigger it.
      await withUserContext(db, actor.userId, (tx) => membership(tx, actor));
      await moderate(actor, `${request.title}\n${request.description}\n${request.instructions}`);
      return withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, actor);
        try {
          const [row] = await tx
            .insert(skills)
            .values({ ...request, name, workspaceId: actor.workspaceId, userId: actor.userId })
            .returning();
          const [author] = await tx
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, actor.userId));
          return toSkill(row!, author?.name ?? "", workspace.role, actor.userId);
        } catch (error) {
          if (isUniqueViolation(error)) throw taken();
          throw error;
        }
      });
    },

    async update(actor: Actor, skillId: string, input: unknown): Promise<Skill> {
      const request = updateSkillRequestSchema.parse(input);
      if (skillId.startsWith("builtin:")) return toggleBuiltIn(actor, skillId.slice(8), request);
      const text = [request.title, request.description, request.instructions]
        .filter(Boolean)
        .join("\n");
      const editable = async (tx: Transaction) => {
        const workspace = await membership(tx, actor);
        const [current] = await tx
          .select()
          .from(skills)
          .where(and(eq(skills.id, skillId), eq(skills.workspaceId, actor.workspaceId)));
        if (!current) throw errors.notFound("Skill not found");
        if (!canEdit(workspace.role, current.userId, actor.userId)) {
          throw errors.forbidden("Only the author, owners, and admins can change this skill");
        }
        return workspace;
      };
      // Permission first: moderation is a paid call, so only editors can trigger it.
      await withUserContext(db, actor.userId, editable);
      if (text) await moderate(actor, text);
      return withUserContext(db, actor.userId, async (tx) => {
        const workspace = await editable(tx);
        try {
          const [row] = await tx
            .update(skills)
            .set({ ...request, ...(request.title ? { name: nameFor(request.title) } : {}) })
            .where(eq(skills.id, skillId))
            .returning();
          const [author] = await tx
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, row!.userId));
          return toSkill(row!, author?.name ?? "", workspace.role, actor.userId);
        } catch (error) {
          if (isUniqueViolation(error)) throw taken();
          throw error;
        }
      });
    },

    async remove(actor: Actor, skillId: string): Promise<void> {
      if (skillId.startsWith("builtin:")) {
        throw errors.badRequest("built_in_skill", "Built-in skills can be turned off, not deleted");
      }
      await withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, actor);
        const [current] = await tx
          .select()
          .from(skills)
          .where(and(eq(skills.id, skillId), eq(skills.workspaceId, actor.workspaceId)));
        if (!current) throw errors.notFound("Skill not found");
        if (!canEdit(workspace.role, current.userId, actor.userId)) {
          throw errors.forbidden("Only the author, owners, and admins can delete this skill");
        }
        await tx.delete(skills).where(eq(skills.id, skillId));
      });
    },
  };
}

export type SkillsService = ReturnType<typeof createSkillsService>;
