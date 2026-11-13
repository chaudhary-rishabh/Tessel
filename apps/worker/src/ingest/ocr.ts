import { HumanMessage, type AIMessageChunk } from "@langchain/core/messages";
import type { Ai, TextSection } from "@tessel/ai";
import { IngestError } from "./parse";

/** Text recognition sends the whole PDF to a model, so it's for modest scans. */
export const OCR_MAX_BYTES = 20 * 1024 * 1024;
export const OCR_MAX_PAGES = 100;

const INSTRUCTIONS = `This PDF is scanned: its pages are images. Transcribe all of the text on every page, in reading order, exactly as written. Keep headings, lists, and table rows on their own lines (separate table cells with " | "). Don't summarize, translate, or add anything.
Start each page with a line "=== Page N ===".`;

/** The model's transcription, split back into pages. */
export function pagesFromTranscription(text: string): TextSection[] {
  const parts = text.split(/^=== Page (\d+) ===\s*$/m);
  if (parts.length < 3) return text.trim() ? [{ text: text.trim(), page: 1 }] : [];
  const sections: TextSection[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1]?.trim();
    if (body) sections.push({ text: body, page: Number(parts[i]) });
  }
  return sections;
}

/**
 * Reads a scanned PDF with a model that takes PDFs. Counts toward the
 * uploader's caps and lands in the ledger like any model call.
 */
export async function recognizeText(
  ai: Ai,
  owner: { userId: string; workspaceId: string },
  pdf: { bytes: Buffer; filename: string; pageCount: number | null },
  modelId: string,
): Promise<TextSection[]> {
  if (pdf.bytes.length > OCR_MAX_BYTES || (pdf.pageCount ?? 0) > OCR_MAX_PAGES) {
    throw new IngestError(
      "no_text",
      "No text was found, and this scan is too large to read (up to 20 MB and 100 pages)",
    );
  }
  const model = ai.chatModel({ ...owner, feature: "ocr" }, modelId, {
    temperature: 0,
    maxOutputTokens: 32_000,
  });
  const reply = (await model.invoke([
    new HumanMessage({
      content: [
        { type: "text", text: INSTRUCTIONS },
        {
          type: "file",
          file: {
            filename: pdf.filename,
            file_data: `data:application/pdf;base64,${pdf.bytes.toString("base64")}`,
          },
        },
      ],
    }),
  ])) as AIMessageChunk;
  const text = typeof reply.content === "string" ? reply.content : reply.text;
  return pagesFromTranscription(text);
}
