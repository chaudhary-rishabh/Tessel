import { entityKey, type EntityHit, type GraphFact, type GraphStore } from "./types";

interface StoredEntity {
  workspaceId: string;
  key: string;
  name: string;
  type: string;
  description: string;
  documents: Set<string>;
}

interface StoredRelation {
  workspaceId: string;
  source: string;
  target: string;
  type: string;
  description: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
}

/** The knowledge graph in memory, for tests and local development without Neo4j. */
export function memoryGraphStore(): GraphStore & {
  entities: Map<string, StoredEntity>;
  relations: StoredRelation[];
} {
  const entities = new Map<string, StoredEntity>();
  let relations: StoredRelation[] = [];
  const id = (workspaceId: string, key: string) => `${workspaceId}:${key}`;

  const store: GraphStore & { entities: Map<string, StoredEntity>; relations: StoredRelation[] } = {
    entities,
    get relations() {
      return relations;
    },
    ensureSchema: async () => undefined,
    async replaceDocument(workspaceId, document, extractions) {
      await store.deleteDocument(workspaceId, document.id);
      for (const extraction of extractions) {
        for (const entity of extraction.entities) {
          const key = entityKey(entity.name);
          if (!key) continue;
          const existing = entities.get(id(workspaceId, key));
          entities.set(id(workspaceId, key), {
            workspaceId,
            key,
            name: existing?.name ?? entity.name,
            type: existing?.type ?? entity.type,
            description: existing?.description || entity.description,
            documents: new Set([...(existing?.documents ?? []), document.id]),
          });
        }
        for (const relation of extraction.relations) {
          const source = entityKey(relation.source);
          const target = entityKey(relation.target);
          if (!entities.has(id(workspaceId, source)) || !entities.has(id(workspaceId, target)))
            continue;
          relations.push({
            workspaceId,
            source,
            target,
            type: relation.type,
            description: relation.description,
            documentId: document.id,
            filename: document.filename,
            chunkIndex: extraction.chunkIndex,
          });
        }
      }
    },
    async deleteDocument(workspaceId, documentId) {
      relations = relations.filter(
        (item) => !(item.workspaceId === workspaceId && item.documentId === documentId),
      );
      for (const [key, entity] of entities) {
        if (entity.workspaceId !== workspaceId) continue;
        entity.documents.delete(documentId);
        if (entity.documents.size === 0) entities.delete(key);
      }
    },
    async findEntities(workspaceId, names, limit = 5) {
      const wanted = names.map(entityKey).filter(Boolean);
      const hits: EntityHit[] = [];
      for (const entity of entities.values()) {
        if (entity.workspaceId !== workspaceId) continue;
        const exact = wanted.includes(entity.key);
        const partial = wanted.some((key) => entity.key.includes(key) || key.includes(entity.key));
        if (exact || partial)
          hits.push({
            key: entity.key,
            name: entity.name,
            type: entity.type,
            description: entity.description,
          });
      }
      return hits
        .sort((a, b) => Number(wanted.includes(b.key)) - Number(wanted.includes(a.key)))
        .slice(0, limit);
    },
    async neighborhood(workspaceId, keys, { depth = 2, limit = 25 } = {}) {
      const seen = new Set(keys);
      const facts: GraphFact[] = [];
      let frontier = new Set(keys);
      for (let hop = 0; hop < depth && frontier.size; hop += 1) {
        const next = new Set<string>();
        for (const relation of relations) {
          if (relation.workspaceId !== workspaceId) continue;
          if (!frontier.has(relation.source) && !frontier.has(relation.target)) continue;
          const source = entities.get(id(workspaceId, relation.source))!;
          const target = entities.get(id(workspaceId, relation.target))!;
          const fact: GraphFact = {
            source: source.name,
            sourceType: source.type,
            type: relation.type,
            target: target.name,
            targetType: target.type,
            description: relation.description,
            documentId: relation.documentId,
            filename: relation.filename,
            chunkIndex: relation.chunkIndex,
          };
          if (
            !facts.some(
              (item) =>
                item.source === fact.source &&
                item.type === fact.type &&
                item.target === fact.target,
            )
          ) {
            facts.push(fact);
          }
          for (const key of [relation.source, relation.target]) {
            if (!seen.has(key)) {
              seen.add(key);
              next.add(key);
            }
          }
        }
        frontier = next;
      }
      return facts.slice(0, limit);
    },
    async counts(workspaceId) {
      return {
        entities: [...entities.values()].filter((entity) => entity.workspaceId === workspaceId)
          .length,
        relations: relations.filter((relation) => relation.workspaceId === workspaceId).length,
      };
    },
    ping: async () => undefined,
    close: async () => undefined,
  };
  return store;
}
