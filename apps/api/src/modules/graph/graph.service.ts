import type { AiCallContext, Source } from "@tessel/ai";
import { withUserContext, type Database } from "@tessel/db";
import { factsToSources, type EntityHit, type GraphFact, type GraphStore } from "@tessel/graph";
import { z } from "zod";
import { errors } from "../../lib/errors";
import { workspacesRepository } from "../workspaces/workspaces.repository";

export interface Actor {
  userId: string;
  workspaceId: string;
}

/** How many relationships a question gets, around at most this many entities. */
const MAX_FACTS = 25;
const MAX_ENTITIES = 4;

export const graphQuerySchema = z.object({
  entity: z.string().trim().max(120).optional(),
  depth: z.coerce.number().int().min(1).max(2).default(1),
});

export interface GraphOverview {
  enabled: boolean;
  counts: { entities: number; relations: number };
  entities: EntityHit[];
  facts: GraphFact[];
}

/**
 * The knowledge graph built from a workspace's documents (graph RAG). Every
 * member can read it, like the documents it comes from.
 */
export function createGraphService({
  db,
  graph,
}: {
  db: Database;
  graph?: GraphStore | undefined;
}) {
  async function membership(actor: Actor) {
    const workspace = await withUserContext(db, actor.userId, (tx) =>
      workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId),
    );
    if (!workspace) throw errors.notFound("Workspace not found");
  }

  /** Relationships around the named entities. */
  async function relationships(workspaceId: string, names: string[], depth: 1 | 2 = 2) {
    if (!graph || names.length === 0)
      return { entities: [] as EntityHit[], facts: [] as GraphFact[] };
    const entities = await graph.findEntities(workspaceId, names, MAX_ENTITIES);
    const facts = await graph.neighborhood(
      workspaceId,
      entities.map((entity) => entity.key),
      { depth, limit: MAX_FACTS },
    );
    return { entities, facts };
  }

  return {
    enabled: Boolean(graph),
    relationships,

    /** For the RAG pipeline: relationships as citable sources. */
    async lookup(context: AiCallContext, names: string[], startId: number): Promise<Source[]> {
      const { facts } = await relationships(context.workspaceId, names);
      return factsToSources(facts, startId);
    },

    async explore(actor: Actor, query: unknown): Promise<GraphOverview> {
      const { entity, depth } = graphQuerySchema.parse(query);
      await membership(actor);
      if (!graph)
        return { enabled: false, counts: { entities: 0, relations: 0 }, entities: [], facts: [] };
      const counts = await graph.counts(actor.workspaceId);
      const found = entity
        ? await relationships(actor.workspaceId, [entity], depth as 1 | 2)
        : { entities: [], facts: [] };
      return { enabled: true, counts, ...found };
    },

    async forgetDocument(workspaceId: string, documentId: string) {
      await graph?.deleteDocument(workspaceId, documentId);
    },
  };
}

export type GraphService = ReturnType<typeof createGraphService>;
