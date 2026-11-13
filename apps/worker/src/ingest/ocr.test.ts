import {
  createAi,
  createSpendGuard,
  loadModelRegistry,
  memorySpendStore,
  memoryVectorIndex,
} from "@tessel/ai";
import { memoryLedger, startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { DocumentRow } from "@tessel/db";
import { createLogger } from "@tessel/logger";
import { storageKeys } from "@tessel/storage";
import { memoryObjectStore } from "@tessel/storage/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestDocument } from "./ingest";
import { pagesFromTranscription } from "./ocr";
import type { DocumentStore } from "./store";

const logger = createLogger("worker-test", { level: "silent", pretty: false });
const workspaceId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

/** A one-page PDF with no text on it, like a scan. */
function blankPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

let gateway: MockGateway;
beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(() => gateway.close());

function setup() {
  const ledger = memoryLedger();
  const ai = createAi({
    gateway: { apiKey: "test", baseURL: gateway.url },
    registry: loadModelRegistry(),
    spend: createSpendGuard({
      store: memorySpendStore(),
      limits: { userDailyUsd: 100, workspaceDailyUsd: 100, globalDailyUsd: 100 },
      logger,
    }),
    ledger,
    moderation: { mode: "off", failure: "allow" },
    logger,
    timeoutMs: 5_000,
  });
  const changes: { status: string; errorCode?: string }[] = [];
  const store: DocumentStore = {
    uploaderOf: async () => userId,
    start: async () => {
      changes.push({ status: "processing" });
      return {
        id: documentId,
        workspaceId,
        userId,
        filename: "invoice-scan.pdf",
        mediaType: "application/pdf",
        sizeBytes: 0,
        storageKey: storageKeys.documentOriginal(workspaceId, documentId),
        status: "queued",
      } as DocumentRow;
    },
    finish: async () => {
      changes.push({ status: "ready" });
      return true;
    },
    fail: async (_user, _doc, errorCode) => void changes.push({ status: "failed", errorCode }),
  };
  const objects = memoryObjectStore();
  return { ai, ledger, changes, store, objects, index: memoryVectorIndex() };
}

describe("scanned PDFs", () => {
  it("splits a transcription back into pages", () => {
    expect(pagesFromTranscription("=== Page 1 ===\nHello\n\n=== Page 3 ===\nWorld\n")).toEqual([
      { text: "Hello", page: 1 },
      { text: "World", page: 3 },
    ]);
    expect(pagesFromTranscription("Just text")).toEqual([{ text: "Just text", page: 1 }]);
  });

  it("reads a scan with the text recognition model, page by page", async () => {
    const t = setup();
    await t.objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      blankPdf(),
      "application/pdf",
    );
    const outcome = await ingestDocument(
      { ...t, logger, ocrModel: "google/gemini-3.5-flash-lite" },
      { workspaceId, documentId },
      { isLastAttempt: false },
    );
    expect(outcome).toBe("ready");
    const points = [...t.index.points.values()].map((point) => point.payload);
    expect(points).toContainEqual(
      expect.objectContaining({ text: "The zephyrine total is 1,240 euros.", page: 2 }),
    );
    expect(t.ledger.events).toContainEqual(
      expect.objectContaining({ feature: "ocr", modelId: "google/gemini-3.5-flash-lite" }),
    );
    // The PDF went to the model as a file.
    const sent = gateway.requests
      .filter((entry) => entry.path.endsWith("/chat/completions"))
      .at(-1)!;
    const content = (sent.body as { messages: { content: { type: string }[] }[] }).messages[0]!
      .content;
    expect(content.map((part) => part.type)).toEqual(["text", "file"]);
  });

  it("fails a scan when there's no text recognition", async () => {
    const t = setup();
    await t.objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      blankPdf(),
      "application/pdf",
    );
    expect(
      await ingestDocument({ ...t, logger }, { workspaceId, documentId }, { isLastAttempt: false }),
    ).toBe("failed");
    expect(t.changes.at(-1)).toEqual({ status: "failed", errorCode: "no_text" });
  });
});
