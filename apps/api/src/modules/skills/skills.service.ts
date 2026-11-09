import { builtInSkills, skillName, type Ai, type SkillDefinition } from "@tessel/ai";
import {
  createSkillRequestSchema,
  updateSkillRequestSchema,
  type Skill,
  type WorkspaceRole,
} from "@tessel/contracts";
import {
  skills,
  users,
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

function builtIn(skill: SkillDefinition): Skill {
  return {
    id: `builtin:${skill.name}`,
    name: skill.name,
    title: skill.title,
    description: skill.description,
    instructions: skill.instructions,
    builtIn: true,
    enabled: true,
    author: null,
    canEdit: false,
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

  async function rows(tx: Transaction, workspaceId: string) {
    return tx
      .select({ skill: skills, authorName: users.name })
      .from(skills)
      .innerJoin(users, eq(users.id, skills.userId))
      .where(eq(skills.workspaceId, workspaceId))
      .orderBy(asc(skills.title));
  }

  const toSkill = (
    row: SkillRow,
    authorName: string,
    role: WorkspaceRole,
    userId: string,
  ): Skill => ({
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

  return {
    async list(actor: Actor): Promise<Skill[]> {
      return withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, actor);
        const own = (await rows(tx, actor.workspaceId)).map(({ skill, authorName }) =>
          toSkill(skill, authorName, workspace.role, actor.userId),
        );
        return [...own, ...builtInSkills.map(builtIn)];
      });
    },

    /** The skills the agent may load in this workspace. */
    async forAgent(actor: Actor): Promise<SkillDefinition[]> {
      const own = await withUserContext(db, actor.userId, (tx) =>
        tx
          .select()
          .from(skills)
          .where(and(eq(skills.workspaceId, actor.workspaceId), eq(skills.enabled, true)))
          .orderBy(asc(skills.title)),
      );
      return [
        ...own.map((row) => ({
          name: row.name,
          title: row.title,
          description: row.description,
          instructions: row.instructions,
          builtIn: false,
        })),
        ...builtInSkills,
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
