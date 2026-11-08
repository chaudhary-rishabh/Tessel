import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

/** A page (or the whole text, for formats without pages) from a parsed document. */
export interface TextSection {
  text: string;
  /** 1-based page number, when the format has pages. */
  page?: number;
}

export interface Chunk {
  index: number;
  text: string;
  page?: number;
}

/** About 300 to 400 tokens per chunk, with overlap so sentences split across chunks still match. */
export const CHUNK_SIZE = 1_500;
export const CHUNK_OVERLAP = 200;

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
  separators: ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""],
});

/** Normalises whitespace without merging paragraphs. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits sections into chunks that never cross a page, so citations can name the page. */
export async function chunkSections(sections: TextSection[]): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const text = cleanText(section.text);
    if (!text) continue;
    for (const piece of await splitter.splitText(text)) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      chunks.push({
        index: chunks.length,
        text: trimmed,
        ...(section.page ? { page: section.page } : {}),
      });
    }
  }
  return chunks;
}
