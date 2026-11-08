import {
  createAi,
  createSpendGuard,
  loadModelRegistry,
  memorySpendStore,
  memoryVectorIndex,
  sparseVector,
} from "@tessel/ai";
import { memoryLedger, startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { DocumentRow } from "@tessel/db";
import { memoryGraphStore } from "@tessel/graph";
import { createLogger } from "@tessel/logger";
import { ingestJobId } from "@tessel/queue";
import { objectCreatedEventBody, storageKeys } from "@tessel/storage";
import { memoryObjectStore, memoryUploadQueue } from "@tessel/storage/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleUploadMessage, startUploadConsumer } from "./consumer";
import { ingestDocument } from "./ingest";
import { htmlToText, parseDocument } from "./parse";
import type { DocumentStore } from "./store";

const logger = createLogger("worker-test", { level: "silent", pretty: false });
const workspaceId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

/** A one-page PDF with real text, built by hand so offsets in the xref table are exact. */
function tinyPdf(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${`BT /F1 18 Tf 20 80 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 20 80 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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

function fakeStore(document: Partial<DocumentRow> | null) {
  const changes: { status: string; errorCode?: string; chunkCount?: number }[] = [];
  let exists = document !== null;
  const row = {
    id: documentId,
    workspaceId,
    userId,
    filename: "notes.md",
    mediaType: "text/markdown",
    sizeBytes: 0,
    storageKey: storageKeys.documentOriginal(workspaceId, documentId),
    status: "queued",
    ...document,
  } as DocumentRow;
  const store: DocumentStore = {
    uploaderOf: async () => (exists ? userId : null),
    start: async () => {
      if (!exists) return undefined;
      changes.push({ status: "processing" });
      return row;
    },
    finish: async (_user, _doc, values) => {
      changes.push({ status: "ready", chunkCount: values.chunkCount });
      return exists;
    },
    fail: async (_user, _doc, errorCode) => {
      changes.push({ status: "failed", errorCode });
    },
  };
  return { store, changes, remove: () => (exists = false) };
}

let gateway: MockGateway;
beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(() => gateway.close());

function setup(limits = { userDailyUsd: 100, workspaceDailyUsd: 100, globalDailyUsd: 100 }) {
  const ledger = memoryLedger();
  const ai = createAi({
    gateway: { apiKey: "test", baseURL: gateway.url },
    registry: loadModelRegistry(),
    spend: createSpendGuard({ store: memorySpendStore(), limits, logger }),
    ledger,
    moderation: { mode: "off", failure: "allow" },
    logger,
    timeoutMs: 5_000,
  });
  return { ai, ledger, objects: memoryObjectStore(), index: memoryVectorIndex() };
}

describe("parsing", () => {
  it("reads PDFs page by page", async () => {
    const parsed = await parseDocument(tinyPdf("Quarterly revenue grew"), "application/pdf");
    expect(parsed.pageCount).toBe(1);
    expect(parsed.sections[0]).toMatchObject({ page: 1 });
    expect(parsed.sections[0]!.text).toContain("Quarterly revenue grew");
  });

  it("keeps only visible text from HTML", () => {
    const text = htmlToText(
      "<h1>Title</h1><script>alert(1)</script><p>Fish &amp; chips &#x2014; daily</p>",
    );
    expect(text).toContain("Title");
    expect(text).toContain("Fish & chips — daily");
    expect(text).not.toContain("alert");
  });

  it("rejects text that isn't UTF-8 and files that aren't documents", async () => {
    await expect(
      parseDocument(Buffer.from([0xff, 0xfe, 0x00, 0xd8]), "text/plain"),
    ).rejects.toMatchObject({
      code: "unsupported_encoding",
    });
    await expect(parseDocument(Buffer.from("x"), "application/zip")).rejects.toMatchObject({
      code: "unsupported_file_type",
    });
    await expect(parseDocument(Buffer.from("not a pdf"), "application/pdf")).rejects.toMatchObject({
      code: "unreadable_file",
    });
  });
});

describe("ingestDocument", () => {
  it("indexes a document as searchable chunks and records the embedding cost", async () => {
    const { ai, ledger, objects, index } = setup();
    const { store, changes } = fakeStore({});
    const text = `# Onboarding\n\n${"New starters get a laptop on day one. ".repeat(120)}\n\nThe zephyrine policy covers travel.`;
    await objects.put(storageKeys.documentOriginal(workspaceId, documentId), text, "text/markdown");

    const outcome = await ingestDocument(
      { store, objects, index, ai, logger },
      { workspaceId, documentId },
      { isLastAttempt: false },
    );

    expect(outcome).toBe("ready");
    expect(changes.map((change) => change.status)).toEqual(["processing", "ready"]);
    const chunkCount = changes[1]!.chunkCount!;
    expect(chunkCount).toBeGreaterThan(1);
    expect(index.points.size).toBe(chunkCount);
    expect(
      (await objects.get(storageKeys.documentText(workspaceId, documentId))).toString(),
    ).toContain("zephyrine");
    expect(ledger.events).toEqual([
      expect.objectContaining({ feature: "embedding", status: "ok", userId, workspaceId }),
    ]);

    const hits = await index.search({
      workspaceId,
      dense: new Array(1536).fill(0.01),
      sparse: sparseVector("zephyrine"),
      limit: 1,
    });
    expect(hits[0]!.payload.text).toContain("zephyrine");
  });

  it("builds the knowledge graph from the document, without failing it when that breaks", async () => {
    const { ai, objects, index } = setup();
    const { store } = fakeStore({ filename: "org.md" });
    const graph = memoryGraphStore();
    await objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      "# Org\n\nMOCK_REL: Alice Chen (Person) | MANAGES | Payments Team (Team)\nMOCK_REL: Payments Team (Team) | OWNS | Ledger Service (System)",
      "text/markdown",
    );
    const outcome = await ingestDocument(
      { store, objects, index, ai, logger, graph },
      { workspaceId, documentId },
      { isLastAttempt: false },
    );
    expect(outcome).toBe("ready");
    expect(await graph.counts(workspaceId)).toEqual({ entities: 3, relations: 2 });
    const [alice] = await graph.findEntities(workspaceId, ["Alice Chen"]);
    const facts = await graph.neighborhood(workspaceId, [alice!.key]);
    expect(facts.map((fact) => [fact.type, fact.filename])).toEqual([
      ["MANAGES", "org.md"],
      ["OWNS", "org.md"],
    ]);

    const broken = { ...graph, replaceDocument: () => Promise.reject(new Error("Neo4j is down")) };
    expect(
      await ingestDocument(
        { store, objects, index, ai, logger, graph: broken },
        { workspaceId, documentId },
        { isLastAttempt: false },
      ),
    ).toBe("ready");
  });

  it("re-indexing replaces the old chunks", async () => {
    const { ai, objects, index } = setup();
    const { store } = fakeStore({});
    const key = storageKeys.documentOriginal(workspaceId, documentId);
    await objects.put(key, "First version. ".repeat(400), "text/plain");
    await ingestDocument(
      { store, objects, index, ai, logger },
      { workspaceId, documentId },
      { isLastAttempt: false },
    );
    const before = index.points.size;
    await objects.put(key, "Short second version.", "text/plain");
    await ingestDocument(
      { store, objects, index, ai, logger },
      { workspaceId, documentId },
      { isLastAttempt: false },
    );
    expect(before).toBeGreaterThan(1);
    expect(index.points.size).toBe(1);
  });

  it("fails documents the user has to fix, without retrying", async () => {
    const { ai, objects, index } = setup();
    const { store, changes } = fakeStore({ mediaType: "text/plain" });
    await objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      "   \n\n  ",
      "text/plain",
    );
    expect(
      await ingestDocument(
        { store, objects, index, ai, logger },
        { workspaceId, documentId },
        { isLastAttempt: false },
      ),
    ).toBe("failed");
    expect(changes.at(-1)).toEqual({ status: "failed", errorCode: "no_text" });

    const missing = fakeStore({});
    await ingestDocument(
      { store: missing.store, objects: memoryObjectStore(), index, ai, logger },
      { workspaceId, documentId },
      { isLastAttempt: false },
    );
    expect(missing.changes.at(-1)).toEqual({ status: "failed", errorCode: "file_missing" });
  });

  it("stops at the uploader's spend cap", async () => {
    const { ai, objects, index } = setup({
      userDailyUsd: 100,
      workspaceDailyUsd: 100,
      globalDailyUsd: 100,
    });
    await ai.spend.add({ userId, workspaceId }, 200 * 1e9);
    const { store, changes } = fakeStore({});
    await objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      "Some text",
      "text/plain",
    );
    await ingestDocument(
      { store, objects, index, ai, logger },
      { workspaceId, documentId },
      { isLastAttempt: false },
    );
    expect(changes.at(-1)).toEqual({ status: "failed", errorCode: "daily_cost_cap_reached" });
    expect(index.points.size).toBe(0);
  });

  it("retries unexpected failures, marking the document failed only on the last attempt", async () => {
    const { ai, objects } = setup();
    const broken = {
      ...memoryVectorIndex(),
      upsert: () => Promise.reject(new Error("Qdrant down")),
    };
    await objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      "Some text",
      "text/plain",
    );

    const first = fakeStore({});
    await expect(
      ingestDocument(
        { store: first.store, objects, index: broken, ai, logger },
        { workspaceId, documentId },
        { isLastAttempt: false },
      ),
    ).rejects.toThrow("Qdrant down");
    expect(first.changes.map((change) => change.status)).toEqual(["processing"]);

    const last = fakeStore({});
    await expect(
      ingestDocument(
        { store: last.store, objects, index: broken, ai, logger },
        { workspaceId, documentId },
        { isLastAttempt: true },
      ),
    ).rejects.toThrow("Qdrant down");
    expect(last.changes.at(-1)).toEqual({ status: "failed", errorCode: "processing_failed" });
  });

  it("skips documents deleted before or during indexing", async () => {
    const { ai, objects, index } = setup();
    const gone = fakeStore(null);
    expect(
      await ingestDocument(
        { store: gone.store, objects, index, ai, logger },
        { workspaceId, documentId },
        { isLastAttempt: false },
      ),
    ).toBe("skipped");

    const deletedMidway = fakeStore({});
    await objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      "Some text",
      "text/plain",
    );
    const store = { ...deletedMidway.store, finish: async () => false };
    expect(
      await ingestDocument(
        { store, objects, index, ai, logger },
        { workspaceId, documentId },
        { isLastAttempt: false },
      ),
    ).toBe("skipped");
    expect(index.points.size).toBe(0);
  });
});

describe("upload events", () => {
  const key = storageKeys.documentOriginal(workspaceId, documentId);

  it("queues one ingest job per document upload and ignores other objects", async () => {
    const added: { data: unknown; options: Record<string, unknown> }[] = [];
    const queue = {
      add: async (_name: "ingest", data: unknown, options: Record<string, unknown>) =>
        added.push({ data, options }),
    };
    expect(
      await handleUploadMessage(objectCreatedEventBody({ bucket: "tessel", key }), {
        bucket: "tessel",
        queue,
        logger,
      }),
    ).toBe(1);
    expect(added[0]).toMatchObject({
      data: { workspaceId, documentId },
      options: { jobId: ingestJobId(documentId), attempts: 3 },
    });

    const other = objectCreatedEventBody({
      bucket: "tessel",
      key: storageKeys.attachment(workspaceId, documentId),
    });
    expect(await handleUploadMessage(other, { bucket: "tessel", queue, logger })).toBe(0);
    expect(
      await handleUploadMessage(objectCreatedEventBody({ bucket: "elsewhere", key }), {
        bucket: "tessel",
        queue,
        logger,
      }),
    ).toBe(0);
  });

  it("deletes messages only after their jobs are queued", async () => {
    const uploads = memoryUploadQueue();
    await uploads.send(objectCreatedEventBody({ bucket: "tessel", key }));
    let fail = true;
    const added: unknown[] = [];
    const queue = {
      add: async (_name: "ingest", data: unknown) => {
        if (fail) throw new Error("Redis down");
        added.push(data);
      },
    };
    const consumer = startUploadConsumer({
      uploads,
      bucket: "tessel",
      queue,
      logger,
      waitSeconds: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(uploads.pending()).toBe(1);
    fail = false;
    await consumer.stop();

    // SQS redelivers it after the visibility timeout; simulate that delivery.
    let delivered = false;
    const redelivering = {
      ...uploads,
      receive: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (delivered) return [];
        delivered = true;
        return [
          {
            body: objectCreatedEventBody({ bucket: "tessel", key }),
            receiptHandle: "m1",
            receiveCount: 2,
          },
        ];
      },
    };
    const retry = startUploadConsumer({
      uploads: redelivering,
      bucket: "tessel",
      queue,
      logger,
      waitSeconds: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await retry.stop();
    expect(added).toHaveLength(1);
    expect(uploads.pending()).toBe(0);
    expect(consumer.isHealthy()).toBe(true);
  });
});
