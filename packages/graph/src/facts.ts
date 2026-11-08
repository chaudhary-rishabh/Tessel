import type { Source } from "@tessel/ai";
import type { GraphFact } from "./types";

const readable = (type: string) => type.toLowerCase().replace(/_/g, " ");

/** One line per relationship, e.g. "Alice Chen (Person) manages Payments Team (Team): Alice leads payments." */
export function factLine(fact: GraphFact): string {
  return `${fact.source} (${fact.sourceType}) ${readable(fact.type)} ${fact.target} (${fact.targetType})${fact.description ? `: ${fact.description}` : ""}`;
}

/**
 * Turns graph facts into citable sources, one per document they came from,
 * numbered after `startId`, so answers can cite relationships like passages.
 */
export function factsToSources(facts: GraphFact[], startId: number): Source[] {
  const byDocument = new Map<string, GraphFact[]>();
  for (const fact of facts)
    byDocument.set(fact.documentId, [...(byDocument.get(fact.documentId) ?? []), fact]);
  return [...byDocument.values()].map((group, position) => ({
    id: startId + position,
    documentId: group[0]!.documentId,
    filename: group[0]!.filename,
    page: null,
    chunkIndex: group[0]!.chunkIndex,
    text: [
      "Relationships from the knowledge graph:",
      ...group.map((fact) => `- ${factLine(fact)}`),
    ].join("\n"),
  }));
}
