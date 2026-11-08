/** A person, team, project, product, or other named thing in a document. */
export interface ExtractedEntity {
  name: string;
  type: string;
  description: string;
}

/** A directed, typed link between two entities, e.g. Alice —MANAGES→ Payments. */
export interface ExtractedRelation {
  source: string;
  target: string;
  /** UPPER_SNAKE_CASE, e.g. MANAGES, PART_OF, DEPENDS_ON. */
  type: string;
  description: string;
}

export interface GraphExtraction {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  /** The first chunk of the text the extraction came from, for citations. */
  chunkIndex: number;
}

export interface GraphDocument {
  id: string;
  filename: string;
}

export interface EntityHit {
  key: string;
  name: string;
  type: string;
  description: string;
}

/** One relationship, with the document it came from. */
export interface GraphFact {
  source: string;
  sourceType: string;
  type: string;
  target: string;
  targetType: string;
  description: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
}

/**
 * The knowledge graph: entities and relationships found in a workspace's
 * documents. Every call is scoped to one workspace.
 */
export interface GraphStore {
  ensureSchema(): Promise<void>;
  /** Replaces everything a document contributed with these extractions. */
  replaceDocument(
    workspaceId: string,
    document: GraphDocument,
    extractions: GraphExtraction[],
  ): Promise<void>;
  deleteDocument(workspaceId: string, documentId: string): Promise<void>;
  /** Entities whose names match, best first. */
  findEntities(workspaceId: string, names: string[], limit?: number): Promise<EntityHit[]>;
  /** Relationships within `depth` hops of the given entities. */
  neighborhood(
    workspaceId: string,
    keys: string[],
    options?: { depth?: 1 | 2; limit?: number },
  ): Promise<GraphFact[]>;
  counts(workspaceId: string): Promise<{ entities: number; relations: number }>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** The key an entity is stored under: case, spacing, and punctuation don't matter. */
export function entityKey(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

/** Relationship types as stored: UPPER_SNAKE_CASE letters and digits only. */
export function relationType(type: string): string {
  const clean = type
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || "RELATED_TO";
}
