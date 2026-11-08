import neo4j, { type Driver } from "neo4j-driver";
import { entityKey, type EntityHit, type GraphFact, type GraphStore } from "./types";

/**
 * The knowledge graph in Neo4j:
 *   (:Entity {workspace_id, key, name, type, description})
 *   (:Entity)-[:MENTIONED_IN]->(:Document {id, workspace_id, filename})
 *   (:Entity)-[:RELATES {type, description, document_id, filename, chunk_index}]->(:Entity)
 * Neo4j has no row-level security, so every query matches on workspace_id,
 * always from a parameter.
 */
export function createNeo4jGraphStore({
  url,
  username,
  password,
}: {
  url: string;
  username: string;
  password: string;
}): GraphStore {
  const driver: Driver = neo4j.driver(url, neo4j.auth.basic(username, password), {
    connectionTimeout: 5_000,
    maxConnectionPoolSize: 20,
    disableLosslessIntegers: true,
  });
  const read = async <T>(
    query: string,
    params: Record<string, unknown>,
    map: (record: Record<string, unknown>) => T,
  ) => {
    const result = await driver.executeQuery(query, params, { routing: neo4j.routing.READ });
    return result.records.map((record) => map(record.toObject()));
  };

  return {
    async ensureSchema() {
      for (const statement of [
        "CREATE CONSTRAINT entity_key IF NOT EXISTS FOR (e:Entity) REQUIRE (e.workspace_id, e.key) IS UNIQUE",
        "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
        "CREATE INDEX entity_workspace IF NOT EXISTS FOR (e:Entity) ON (e.workspace_id)",
        "CREATE INDEX relates_document IF NOT EXISTS FOR ()-[r:RELATES]-() ON (r.document_id)",
      ]) {
        await driver.executeQuery(statement);
      }
    },

    async replaceDocument(workspaceId, document, extractions) {
      const entities = new Map<
        string,
        { key: string; name: string; type: string; description: string }
      >();
      for (const extraction of extractions) {
        for (const entity of extraction.entities) {
          const key = entityKey(entity.name);
          if (key && !entities.has(key)) {
            entities.set(key, {
              key,
              name: entity.name,
              type: entity.type,
              description: entity.description,
            });
          }
        }
      }
      const relations = extractions.flatMap((extraction) =>
        extraction.relations
          .map((relation) => ({
            source: entityKey(relation.source),
            target: entityKey(relation.target),
            type: relation.type,
            description: relation.description,
            chunkIndex: extraction.chunkIndex,
          }))
          .filter((relation) => entities.has(relation.source) && entities.has(relation.target)),
      );
      const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
      try {
        await session.executeWrite(async (tx) => {
          await removeDocument(tx, workspaceId, document.id);
          await tx.run(
            `MERGE (d:Document {id: $documentId})
             SET d.workspace_id = $workspaceId, d.filename = $filename
             WITH d
             UNWIND $entities AS entity
             MERGE (e:Entity {workspace_id: $workspaceId, key: entity.key})
               ON CREATE SET e.name = entity.name, e.type = entity.type, e.description = entity.description
               ON MATCH SET e.description = CASE WHEN coalesce(e.description, '') = '' THEN entity.description ELSE e.description END
             MERGE (e)-[:MENTIONED_IN]->(d)`,
            {
              workspaceId,
              documentId: document.id,
              filename: document.filename,
              entities: [...entities.values()],
            },
          );
          await tx.run(
            `UNWIND $relations AS relation
             MATCH (a:Entity {workspace_id: $workspaceId, key: relation.source})
             MATCH (b:Entity {workspace_id: $workspaceId, key: relation.target})
             CREATE (a)-[:RELATES {type: relation.type, description: relation.description,
               document_id: $documentId, filename: $filename, chunk_index: relation.chunkIndex}]->(b)`,
            { workspaceId, documentId: document.id, filename: document.filename, relations },
          );
        });
      } finally {
        await session.close();
      }
    },

    async deleteDocument(workspaceId, documentId) {
      const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
      try {
        await session.executeWrite(async (tx) => {
          await removeDocument(tx, workspaceId, documentId);
          await tx.run(
            "MATCH (d:Document {id: $documentId, workspace_id: $workspaceId}) DETACH DELETE d",
            {
              workspaceId,
              documentId,
            },
          );
        });
      } finally {
        await session.close();
      }
    },

    async findEntities(workspaceId, names, limit = 5) {
      const keys = [...new Set(names.map(entityKey).filter(Boolean))];
      if (keys.length === 0) return [];
      return read<EntityHit>(
        `UNWIND $keys AS k
         MATCH (e:Entity {workspace_id: $workspaceId})
         WHERE e.key = k OR e.key CONTAINS k OR k CONTAINS e.key
         WITH e, max(CASE WHEN e.key = k THEN 1 ELSE 0 END) AS exact
         RETURN e.key AS key, e.name AS name, e.type AS type, e.description AS description
         ORDER BY exact DESC, size(e.key) ASC
         LIMIT $limit`,
        { workspaceId, keys, limit: neo4j.int(limit) },
        (record) => record as unknown as EntityHit,
      );
    },

    async neighborhood(workspaceId, keys, { depth = 2, limit = 25 } = {}) {
      if (keys.length === 0) return [];
      return read<GraphFact>(
        `MATCH (start:Entity {workspace_id: $workspaceId}) WHERE start.key IN $keys
         MATCH path = (start)-[:RELATES*1..${depth === 1 ? 1 : 2}]-(:Entity {workspace_id: $workspaceId})
         UNWIND relationships(path) AS r
         WITH DISTINCT r
         MATCH (a:Entity)-[r]->(b:Entity)
         RETURN a.name AS source, a.type AS sourceType, r.type AS type, b.name AS target, b.type AS targetType,
           r.description AS description, r.document_id AS documentId, r.filename AS filename, r.chunk_index AS chunkIndex
         LIMIT $limit`,
        { workspaceId, keys, limit: neo4j.int(limit) },
        (record) => record as unknown as GraphFact,
      );
    },

    async counts(workspaceId) {
      const [row] = await read(
        `MATCH (e:Entity {workspace_id: $workspaceId})
         OPTIONAL MATCH (e)-[r:RELATES]->()
         RETURN count(DISTINCT e) AS entities, count(r) AS relations`,
        { workspaceId },
        (record) => record as { entities: number; relations: number },
      );
      return row ?? { entities: 0, relations: 0 };
    },

    async ping() {
      await driver.executeQuery("RETURN 1");
    },

    close: () => driver.close(),
  };
}

/** Removes a document's relationships and mentions, then entities nothing mentions any more. */
async function removeDocument(
  tx: { run: (query: string, params: Record<string, unknown>) => Promise<unknown> },
  workspaceId: string,
  documentId: string,
) {
  await tx.run(
    "MATCH (:Entity {workspace_id: $workspaceId})-[r:RELATES {document_id: $documentId}]->() DELETE r",
    { workspaceId, documentId },
  );
  await tx.run(
    "MATCH (e:Entity {workspace_id: $workspaceId})-[m:MENTIONED_IN]->(:Document {id: $documentId}) DELETE m",
    { workspaceId, documentId },
  );
  await tx.run(
    "MATCH (e:Entity {workspace_id: $workspaceId}) WHERE NOT (e)-[:MENTIONED_IN]->() DETACH DELETE e",
    { workspaceId },
  );
}
