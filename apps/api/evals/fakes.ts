import { createHash } from "node:crypto";
import { chunkSections, tokenize } from "@tessel/ai";
import { KESTREL_DOCUMENTS } from "@tessel/evals/fixtures";
import type { GraphFact } from "@tessel/graph";
import type { DocumentsService } from "../src/modules/documents/documents.service";
import type { GraphService } from "../src/modules/graph/graph.service";

/**
 * In-memory stand-ins for the services the chat tools call, over the same
 * fictional company documents the RAG suite uses. They record what the
 * agent did, so a suite can check that nothing ran before approval.
 */

/** A stable UUID per fixture document (delete_document takes UUIDs). */
export function documentUuid(id: string): string {
  const hex = createHash("sha256").update(id).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

interface FakeChunk {
  documentId: string;
  filename: string;
  chunkIndex: number;
  text: string;
  tokens: Set<string>;
}

export interface FakeWorkspace {
  documents: DocumentsService;
  graph: GraphService;
  /** Writes the agent actually made (after approval). */
  created: { filename: string; content: string }[];
  deleted: string[];
  searches: string[];
}

export async function createFakeWorkspace(): Promise<FakeWorkspace> {
  const chunks: FakeChunk[] = [];
  for (const document of KESTREL_DOCUMENTS) {
    for (const piece of await chunkSections([{ text: document.text }])) {
      chunks.push({
        documentId: documentUuid(document.id),
        filename: document.filename,
        chunkIndex: piece.index,
        text: piece.text,
        tokens: new Set(tokenize(piece.text)),
      });
    }
  }
  const created: FakeWorkspace["created"] = [];
  const deleted: string[] = [];
  const searches: string[] = [];
  const summaries = () =>
    KESTREL_DOCUMENTS.map((document) => ({
      id: documentUuid(document.id),
      filename: document.filename,
      status: "ready",
      pageCount: null,
    })).filter((summary) => !deleted.includes(summary.id));

  const documents = {
    async search(_actor: unknown, input: { query: string; limit?: number }) {
      searches.push(input.query);
      const query = new Set(tokenize(input.query));
      const hits = chunks
        .filter((chunk) => !deleted.includes(chunk.documentId))
        .map((chunk) => ({
          chunk,
          score: [...query].filter((token) => chunk.tokens.has(token)).length,
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, input.limit ?? 5)
        .map(({ chunk }) => ({
          documentId: chunk.documentId,
          filename: chunk.filename,
          page: null,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          score: 1,
        }));
      return { hits };
    },
    async list() {
      return summaries();
    },
    async get(_actor: unknown, documentId: string) {
      const found = summaries().find((summary) => summary.id === documentId);
      if (!found) throw new Error("Document not found");
      return found;
    },
    async createFromText(_actor: unknown, filename: string, content: string) {
      created.push({ filename, content });
      return { id: documentUuid(filename), filename, status: "processing", pageCount: null };
    },
    async remove(_actor: unknown, documentId: string) {
      deleted.push(documentId);
    },
  } as unknown as DocumentsService;

  const orgChart = KESTREL_DOCUMENTS.find((document) => document.id === "org-chart")!;
  const fact = (
    source: string,
    sourceType: string,
    type: string,
    target: string,
    targetType: string,
  ): GraphFact => ({
    source,
    sourceType,
    type,
    target,
    targetType,
    description: "",
    documentId: documentUuid(orgChart.id),
    filename: orgChart.filename,
    chunkIndex: 0,
  });
  const facts = [
    fact("Priya Raman", "Person", "LEADS", "Signals", "Team"),
    fact("Priya Raman", "Person", "REPORTS_TO", "Arjun Mehta", "Person"),
    fact("Signals", "Team", "OWNS", "Beacon", "Product"),
    fact("Daniel Okafor", "Person", "LEADS", "Platform", "Team"),
    fact("Mei Lin", "Person", "REPORTS_TO", "Daniel Okafor", "Person"),
  ];
  const graph = {
    enabled: true,
    async relationships(_workspaceId: string, names: string[]) {
      const wanted = names.map((name) => name.toLowerCase());
      const matching = facts.filter((item) =>
        wanted.some(
          (name) =>
            item.source.toLowerCase().includes(name) || item.target.toLowerCase().includes(name),
        ),
      );
      const entities = matching.length ? [{ name: names[0]!, type: "Entity" }] : [];
      return { entities, facts: matching };
    },
  } as unknown as GraphService;

  return { documents, graph, created, deleted, searches };
}
