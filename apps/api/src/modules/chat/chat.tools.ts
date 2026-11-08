import {
  calculatorTool,
  currentTimeTool,
  defineTool,
  type Source,
  type ToolDefinition,
} from "@tessel/ai";
import { z } from "zod";
import type { DocumentsService } from "../documents/documents.service";

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
}: {
  documents: DocumentsService;
  workspaceId: string;
  userId: string;
  requestId?: string;
  sources: Source[];
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
      const { hits } = await documents.search(actor, { query, limit });
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

  return [
    searchDocuments,
    listDocuments,
    createDocument,
    deleteDocument,
    calculatorTool,
    currentTimeTool,
  ];
}
