import {
  calculatorTool,
  currentTimeTool,
  defineTool,
  type Source,
  type ToolDefinition,
  type WorkerSpec,
} from "@tessel/ai";
import { z } from "zod";
import { factLine } from "@tessel/graph";
import type { DocumentsService } from "../documents/documents.service";
import type { GraphService } from "../graph/graph.service";

/** The specialists a supervisor can hand work to in team mode. */
export const teamWorkers: WorkerSpec[] = [
  {
    name: "researcher",
    title: "Researcher",
    description: "Finds facts in the workspace's documents and lists what's there.",
    tools: ["search_documents", "list_documents"],
  },
  {
    name: "analyst",
    title: "Analyst",
    description: "Does exact calculations and date and time arithmetic.",
    tools: ["calculator", "current_time"],
  },
  {
    name: "editor",
    title: "Editor",
    description: "Creates or deletes documents in the workspace (the user approves each change).",
    tools: ["create_document", "delete_document"],
  },
];

/** Makes and edits images (and videos), when generation is set up. */
export const designerWorker: WorkerSpec = {
  name: "designer",
  title: "Designer",
  description: "Makes new images, edits existing ones, and makes short videos.",
  tools: ["generate_image", "edit_image", "generate_video"],
};

const escapeAttribute = (value: string) => value.replace(/[<>"&]/g, " ");

/**
 * The tools chat can use in a workspace. `sources` collects passages found
 * by search_documents so the reply can cite them like pre-fetched sources;
 * numbering continues from whatever is already there.
 */
export function workspaceTools({
  documents,
  workspaceId,
  userId,
  requestId,
  sources,
  graph,
  documentIds,
}: {
  documents: DocumentsService;
  workspaceId: string;
  userId: string;
  requestId?: string;
  sources: Source[];
  /** The knowledge graph, when Neo4j is set up. */
  graph?: GraphService;
  /** Documents the user picked for the message; searches stay within them. */
  documentIds?: string[];
}): ToolDefinition[] {
  const actor = { workspaceId, userId, ...(requestId ? { requestId } : {}) };

  const searchDocuments = defineTool({
    name: "search_documents",
    title: "Search documents",
    description:
      "Search the workspace's uploaded documents by meaning and keywords. Use it for questions about the organisation, its policies, products, or anything in its files, and search again with different words if the first results don't answer the question. Cite passages by their source id, like [3].",
    schema: z.object({
      query: z.string().min(1).max(500).describe("A standalone search query"),
      limit: z.number().int().min(1).max(8).default(5),
    }),
    risk: "read",
    async run({ query, limit }) {
      const { hits } = await documents.search(actor, {
        query,
        limit,
        ...(documentIds?.length ? { documentIds } : {}),
      });
      const found = hits.map((hit) => {
        const existing = sources.find(
          (source) => source.documentId === hit.documentId && source.chunkIndex === hit.chunkIndex,
        );
        if (existing) return existing;
        const source: Source = {
          id: sources.length + 1,
          documentId: hit.documentId,
          filename: hit.filename,
          page: hit.page,
          chunkIndex: hit.chunkIndex,
          text: hit.text,
        };
        sources.push(source);
        return source;
      });
      if (found.length === 0) return { content: "No passages matched.", summary: "Nothing found" };
      return {
        content: found
          .map(
            (source) =>
              `<source id="${source.id}" document="${escapeAttribute(source.filename)}"${source.page ? ` page="${source.page}"` : ""}>\n${source.text}\n</source>`,
          )
          .join("\n"),
        summary: `Found ${found.length} passage${found.length === 1 ? "" : "s"}`,
      };
    },
  });

  const listDocuments = defineTool({
    name: "list_documents",
    title: "List documents",
    description: "List the documents in the workspace with their IDs, sizes, and indexing status.",
    schema: z.object({}),
    risk: "read",
    async run() {
      const list = await documents.list(actor);
      if (list.length === 0)
        return { content: "The workspace has no documents.", summary: "No documents" };
      return {
        content: list
          .map(
            (d) =>
              `- ${d.filename} (id ${d.id}, ${d.status}${d.pageCount ? `, ${d.pageCount} pages` : ""})`,
          )
          .join("\n"),
        summary: `${list.length} document${list.length === 1 ? "" : "s"}`,
      };
    },
  });

  const createDocument = defineTool({
    name: "create_document",
    title: "Create a document",
    description:
      "Save text (Markdown) as a new document in the workspace's knowledge base, shared with every member and indexed for search.",
    schema: z.object({
      filename: z
        .string()
        .trim()
        .min(4)
        .max(120)
        .regex(/\.(md|txt)$/i, "Use a .md or .txt file name"),
      content: z.string().min(1).max(200_000),
    }),
    risk: "write",
    describeCall: ({ filename, content }) =>
      `Create "${filename}" in the workspace (${content.length.toLocaleString("en")} characters)`,
    async run({ filename, content }) {
      const document = await documents.createFromText(actor, filename, content);
      return {
        content: `Created ${document.filename} (id ${document.id}). It will be searchable once indexing finishes.`,
        summary: `Created ${document.filename}`,
      };
    },
  });

  const deleteDocument = defineTool({
    name: "delete_document",
    title: "Delete a document",
    description:
      "Delete a document from the workspace by its ID (find IDs with list_documents). This can't be undone.",
    schema: z.object({ document_id: z.uuid() }),
    risk: "destructive",
    describeCall: async ({ document_id }) => {
      const document = await documents.get(actor, document_id).catch(() => null);
      return `Delete "${document?.filename ?? document_id}" for everyone in the workspace`;
    },
    async run({ document_id }) {
      const document = await documents.get(actor, document_id);
      await documents.remove(actor, document_id);
      return { content: `Deleted ${document.filename}.`, summary: `Deleted ${document.filename}` };
    },
  });

  const exploreGraph = graph
    ? defineTool({
        name: "explore_graph",
        title: "Explore connections",
        description:
          "Look up how people, teams, projects, products, or systems in the workspace's documents relate to each other (who manages, owns, works on, or depends on what). Give one name; cite the results by their source id.",
        schema: z.object({
          entity: z.string().min(1).max(120).describe("A name, e.g. a person, team, or project"),
        }),
        risk: "read",
        async run({ entity }) {
          const { entities, facts } = await graph.relationships(workspaceId, [entity]);
          if (facts.length === 0) {
            return {
              content: entities.length
                ? `${entities[0]!.name} is in the documents, but no relationships were found.`
                : `Nothing called "${entity}" was found in the knowledge graph.`,
              summary: "No connections found",
            };
          }
          const groups = new Map<string, string[]>();
          for (const fact of facts)
            groups.set(fact.documentId, [...(groups.get(fact.documentId) ?? []), factLine(fact)]);
          const blocks = [...groups.entries()].map(([documentId, lines]) => {
            const fact = facts.find((item) => item.documentId === documentId)!;
            const source: Source = {
              id: sources.length + 1,
              documentId,
              filename: fact.filename,
              page: null,
              chunkIndex: fact.chunkIndex,
              text: [
                "Relationships from the knowledge graph:",
                ...lines.map((line) => `- ${line}`),
              ].join("\n"),
            };
            sources.push(source);
            return `<source id="${source.id}" document="${escapeAttribute(source.filename)}">\n${source.text}\n</source>`;
          });
          return {
            content: blocks.join("\n"),
            summary: `Found ${facts.length} connection${facts.length === 1 ? "" : "s"}`,
          };
        },
      })
    : undefined;

  return [
    searchDocuments,
    ...(exploreGraph ? [exploreGraph] : []),
    listDocuments,
    createDocument,
    deleteDocument,
    calculatorTool,
    currentTimeTool,
  ];
}
