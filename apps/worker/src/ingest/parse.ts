import type { TextSection } from "@tessel/ai";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { pptxSections, xlsxSections } from "./office";

/** An ingestion failure the user can act on. It is saved on the document and never retried. */
export class IngestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export interface ParsedDocument {
  sections: TextSection[];
  pageCount: number | null;
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new IngestError("unsupported_encoding", "Text files must be UTF-8");
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/** Visible text from HTML: scripts and styles dropped, block tags become line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|blockquote|pre)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (entity, name: string) => {
      if (name.startsWith("#")) {
        const code =
          name[1]?.toLowerCase() === "x"
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      return ENTITIES[name.toLowerCase()] ?? entity;
    });
}

/** Text from an uploaded file, page by page for PDFs. */
export async function parseDocument(bytes: Buffer, mediaType: string): Promise<ParsedDocument> {
  switch (mediaType) {
    case "application/pdf": {
      let pages: string[];
      try {
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        ({ text: pages } = await extractText(pdf, { mergePages: false }));
      } catch {
        throw new IngestError(
          "unreadable_file",
          "This PDF couldn't be read. It may be damaged or password protected",
        );
      }
      return {
        sections: pages.map((text, index) => ({ text, page: index + 1 })),
        pageCount: pages.length,
      };
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      try {
        const { value } = await mammoth.extractRawText({ buffer: bytes });
        return { sections: [{ text: value }], pageCount: null };
      } catch {
        throw new IngestError(
          "unreadable_file",
          "This Word document couldn't be read. It may be damaged",
        );
      }
    }
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
      try {
        return { sections: xlsxSections(bytes), pageCount: null };
      } catch {
        throw new IngestError(
          "unreadable_file",
          "This spreadsheet couldn't be read. It may be damaged",
        );
      }
    }
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
      try {
        const sections = pptxSections(bytes);
        return { sections, pageCount: sections.length };
      } catch {
        throw new IngestError(
          "unreadable_file",
          "This presentation couldn't be read. It may be damaged",
        );
      }
    }
    case "text/html":
      return { sections: [{ text: htmlToText(decodeUtf8(bytes)) }], pageCount: null };
    case "text/plain":
    case "text/markdown":
    case "text/csv":
    case "application/json":
      return { sections: [{ text: decodeUtf8(bytes) }], pageCount: null };
    default:
      throw new IngestError(
        "unsupported_file_type",
        "This file type can't be added to the knowledge base",
      );
  }
}
