import { z } from "zod";
import { createNeo4jGraphStore } from "./neo4j";
import type { GraphStore } from "./types";

const optional = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

/** Settings for the knowledge graph (Neo4j). Without NEO4J_BOLT_URL, graph RAG is off. */
export const graphEnvShape = {
  NEO4J_BOLT_URL: optional.pipe(z.url().optional()),
  /** "user/password", the same value the Neo4j container reads. */
  NEO4J_AUTH: optional,
  /** Extract entities and relationships while indexing documents (costs model calls). */
  GRAPH_EXTRACTION: z.stringbool().default(true),
};

export function graphStoreFromEnv(env: {
  NEO4J_BOLT_URL?: string | undefined;
  NEO4J_AUTH?: string | undefined;
}): GraphStore | undefined {
  if (!env.NEO4J_BOLT_URL) return undefined;
  const [username = "neo4j", ...rest] = (env.NEO4J_AUTH ?? "neo4j/").split("/");
  return createNeo4jGraphStore({ url: env.NEO4J_BOLT_URL, username, password: rest.join("/") });
}
