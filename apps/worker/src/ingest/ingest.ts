import {
  AiError,
  chunkSections,
  sparseVector,
  type Ai,
  type Transcriber,
  type VectorIndex,
} from "@tessel/ai";
import { isRecording, MAX_RECORDING_BYTES, maxUploadBytes } from "@tessel/contracts";
import { extractGraph, graphWindows, type GraphExtraction, type GraphStore } from "@tessel/graph";
import type { Logger } from "@tessel/logger";
import type { IngestJobData } from "@tessel/queue";
import { storageKeys, type ObjectStore } from "@tessel/storage";
import { IngestError, parseDocument, type ParsedDocument } from "./parse";
import type { DocumentStore } from "./store";
import { recognizeText } from "./ocr";
import { speechAudio, transcriptSections } from "./transcribe";

/** About 500 pages of dense text. Larger documents need a summary-first pipeline. */
export const MAX_CHARACTERS = 2_000_000;

export interface IngestDependencies {
  store: DocumentStore;
  objects: ObjectStore;
  index: VectorIndex;
  ai: Ai;
  logger: Logger;
  /** The knowledge graph; without it, documents are only indexed for search. */
  graph?: GraphStore | undefined;
  /** Turns audio and video into text; without it, recordings can't be added. */
  transcriber?: Transcriber | undefined;
  /** The model that reads scanned PDFs; without it, PDFs with no text layer fail. */
  ocrModel?: string | undefined;
}

/**
 * A recording's text: its speech, transcribed with timings. Counts toward
 * the uploader's daily caps and is recorded as feature "transcription".
 */
async function transcribeRecording(
  { ai, transcriber, logger }: Pick<IngestDependencies, "ai" | "transcriber" | "logger">,
  owner: { userId: string; workspaceId: string },
  bytes: Buffer,
): Promise<ParsedDocument> {
  if (!transcriber) {
    throw new IngestError("transcription_unavailable", "Transcribing recordings isn't set up");
  }
  await ai.spend.assertWithinBudget(owner);
  const { audio, converted } = await speechAudio(bytes);
  if (!converted) logger.warn("ffmpeg couldn't convert a recording; sending it as it is");
  const startedAt = Date.now();
  let transcript;
  try {
    transcript = await transcriber.transcribe(audio);
  } catch (error) {
    logger.warn({ err: error }, "Transcription failed");
    throw new IngestError(
      "transcription_failed",
      "This recording couldn't be transcribed. Check that it has speech and plays",
    );
  }
  await ai.tracker.record({
    ...owner,
    requestId: null,
    feature: "transcription",
    route: "gateway",
    modelId: transcriber.modelId,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    estimated: false,
    status: "ok",
    errorCode: null,
    costNanoUsd: transcriber.costNanoUsd(transcript.durationSeconds),
    latencyMs: Date.now() - startedAt,
  });
  return { sections: transcriptSections(transcript), pageCount: null };
}

export type IngestOutcome = "ready" | "failed" | "skipped";

/**
 * Turns an uploaded file into searchable chunks: download, parse, save the
 * text, chunk, embed (dense and keyword vectors), and index in Qdrant.
 * Running it twice for the same document gives the same result, because
 * chunk IDs are stable and old chunks are removed first.
 *
 * Problems the user can act on (unreadable file, spend cap) mark the
 * document failed and return. Anything else is thrown so the job retries;
 * `isLastAttempt` marks the document failed before the final throw.
 */
export async function ingestDocument(
  { store, objects, index, ai, logger, graph, transcriber, ocrModel }: IngestDependencies,
  { workspaceId, documentId }: IngestJobData,
  { isLastAttempt }: { isLastAttempt: boolean },
): Promise<IngestOutcome> {
  const userId = await store.uploaderOf(documentId);
  if (!userId) return "skipped"; // deleted before we got to it
  const document = await store.start(userId, workspaceId, documentId);
  if (!document) return "skipped";
  const log = logger.child({ documentId, workspaceId });

  try {
    const object = await objects.head(document.storageKey);
    if (!object) throw new IngestError("file_missing", "The uploaded file couldn't be found");
    const max = maxUploadBytes(document.filename);
    if (object.size > max) {
      throw new IngestError(
        "file_too_large",
        max === MAX_RECORDING_BYTES ? "Recordings can be up to 500 MB" : "Files can be up to 50 MB",
      );
    }

    const bytes = await objects.get(document.storageKey);
    let parsed = isRecording(document.mediaType)
      ? await transcribeRecording({ ai, transcriber, logger: log }, { userId, workspaceId }, bytes)
      : await parseDocument(bytes, document.mediaType);
    // A PDF with (almost) no text layer is a scan: read it with a model instead.
    const textLength = parsed.sections.reduce(
      (total, section) => total + section.text.trim().length,
      0,
    );
    if (document.mediaType === "application/pdf" && ocrModel && textLength < 20) {
      log.info({ pages: parsed.pageCount }, "Reading a scanned PDF");
      const sections = await recognizeText(
        ai,
        { userId, workspaceId },
        { bytes, filename: document.filename, pageCount: parsed.pageCount },
        ocrModel,
      );
      parsed = { sections, pageCount: parsed.pageCount ?? sections.length };
    }
    const characterCount = parsed.sections.reduce(
      (total, section) => total + section.text.length,
      0,
    );
    if (characterCount > MAX_CHARACTERS) {
      throw new IngestError("document_too_long", "This document has too much text to index");
    }
    const chunks = await chunkSections(parsed.sections);
    if (chunks.length === 0) {
      throw new IngestError(
        "no_text",
        isRecording(document.mediaType)
          ? "No speech was found in this recording"
          : "No text was found, even with text recognition",
      );
    }
    await objects.put(
      storageKeys.documentText(workspaceId, documentId),
      parsed.sections.map((section) => section.text).join("\n\n"),
      "text/plain; charset=utf-8",
    );

    const embeddings = ai.embeddings({ userId, workspaceId, feature: "embedding" });
    const vectors = await embeddings.embedDocuments(chunks.map((chunk) => chunk.text));

    await index.deleteDocument(workspaceId, documentId);
    await index.upsert(
      chunks.map((chunk, position) => ({
        payload: {
          workspace_id: workspaceId,
          document_id: documentId,
          chunk_index: chunk.index,
          text: chunk.text,
          filename: document.filename,
          ...(chunk.page ? { page: chunk.page } : {}),
        },
        dense: vectors[position]!,
        sparse: sparseVector(chunk.text),
      })),
    );

    const stillThere = await store.finish(userId, documentId, {
      pageCount: parsed.pageCount,
      chunkCount: chunks.length,
      characterCount,
    });
    if (!stillThere) {
      // Deleted while we were working: don't leave its chunks behind.
      await index.deleteDocument(workspaceId, documentId);
      return "skipped";
    }
    log.info({ chunks: chunks.length, characters: characterCount }, "Document indexed");
    if (graph) {
      await buildGraph(
        { graph, ai, logger: log },
        { userId, workspaceId, documentId, filename: document.filename },
        chunks,
      );
    }
    return "ready";
  } catch (error) {
    if (error instanceof IngestError || error instanceof AiError) {
      log.warn({ code: error.code, err: error }, "Document could not be indexed");
      await store.fail(userId, documentId, error.code);
      return "failed";
    }
    if (isLastAttempt) {
      log.error({ err: error }, "Document indexing failed after every retry");
      await store.fail(userId, documentId, "processing_failed");
    }
    throw error;
  }
}

const GRAPH_PARALLEL_CALLS = 3;

/**
 * Graph RAG: extracts entities and relationships window by window and
 * replaces the document's part of the knowledge graph. The document is
 * already searchable, so a failure here is logged and doesn't fail it.
 */
async function buildGraph(
  { graph, ai, logger }: { graph: GraphStore; ai: Ai; logger: Logger },
  document: { userId: string; workspaceId: string; documentId: string; filename: string },
  chunks: { index: number; text: string }[],
) {
  const model = ai.chatModel(
    { userId: document.userId, workspaceId: document.workspaceId, feature: "graph" },
    ai.registry.forRole("utility").id,
    { temperature: 0 },
  );
  try {
    const windows = graphWindows(chunks);
    const extractions: GraphExtraction[] = [];
    for (let start = 0; start < windows.length; start += GRAPH_PARALLEL_CALLS) {
      const batch = windows.slice(start, start + GRAPH_PARALLEL_CALLS);
      extractions.push(
        ...(await Promise.all(
          batch.map((window) => extractGraph(model, window.text, window.chunkIndex)),
        )),
      );
    }
    await graph.replaceDocument(
      document.workspaceId,
      { id: document.documentId, filename: document.filename },
      extractions,
    );
    logger.info(
      {
        entities: extractions.reduce((total, item) => total + item.entities.length, 0),
        relations: extractions.reduce((total, item) => total + item.relations.length, 0),
      },
      "Knowledge graph updated",
    );
  } catch (error) {
    logger.warn(
      { err: error },
      "Building the knowledge graph failed; the document is still searchable",
    );
  }
}
