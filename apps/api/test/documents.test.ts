import { memoryVectorIndex, sparseVector } from "@tessel/ai";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { documents, usageEvents, workspaceMembers } from "@tessel/db";
import { parseObjectCreatedEvents, storageKeys } from "@tessel/storage";
import { memoryObjectStore, memoryUploadQueue } from "@tessel/storage/testing";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp, type SignedUpUser } from "./helpers";

let gateway: MockGateway;
beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(() => gateway.close());

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

function setup(uploadEvents: "s3" | "api" = "api") {
  const objects = memoryObjectStore("tessel-test");
  const uploads = memoryUploadQueue();
  const index = memoryVectorIndex();
  const app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url }),
    storage: { objects, uploads, uploadEvents },
    vectorIndex: index,
  });
  return { app, objects, uploads, index };
}

async function workspaceOf(app: Express, user: SignedUpUser): Promise<string> {
  const res = await request(app).get("/workspaces").set("Authorization", bearer(user));
  return res.body.workspaces[0].id;
}

describe("document uploads", () => {
  it("presigns an upload, checks it arrived, and announces it for indexing", async () => {
    const { app, objects, uploads } = setup("api");
    const user = await signUp(app);
    const workspaceId = await workspaceOf(app, user);
    const base = `/workspaces/${workspaceId}/documents`;

    const created = await request(app)
      .post(base)
      .set("Authorization", bearer(user))
      .send({ filename: "Handbook 2026.pdf", sizeBytes: 11 });
    expect(created.status).toBe(201);
    const { document, upload } = created.body;
    expect(document).toMatchObject({
      status: "uploading",
      mediaType: "application/pdf",
      uploadedBy: user.auth.user.id,
    });
    const key = storageKeys.documentOriginal(workspaceId, document.id);
    expect(upload).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/pdf" } });
    expect(upload.url).toContain(key);

    const early = await request(app)
      .post(`${base}/${document.id}/complete`)
      .set("Authorization", bearer(user));
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("upload_incomplete");

    await objects.put(key, Buffer.from("wrong size!!"), "application/pdf");
    const mismatch = await request(app)
      .post(`${base}/${document.id}/complete`)
      .set("Authorization", bearer(user));
    expect(mismatch.body.error.code).toBe("upload_size_mismatch");

    await objects.put(key, Buffer.from("%PDF-1.7 ok"), "application/pdf");
    const done = await request(app)
      .post(`${base}/${document.id}/complete`)
      .set("Authorization", bearer(user));
    expect(done.body.status).toBe("queued");
    const [message] = await uploads.receive();
    expect(parseObjectCreatedEvents(message!.body)).toEqual([
      { bucket: "tessel-test", key, size: 11 },
    ]);

    // Completing twice doesn't queue it twice.
    await request(app).post(`${base}/${document.id}/complete`).set("Authorization", bearer(user));
    expect(uploads.pending()).toBe(1);
  });

  it("leaves announcing to S3 when bucket notifications are on", async () => {
    const { app, objects, uploads } = setup("s3");
    const user = await signUp(app);
    const workspaceId = await workspaceOf(app, user);
    const { body } = await request(app)
      .post(`/workspaces/${workspaceId}/documents`)
      .set("Authorization", bearer(user))
      .send({ filename: "notes.txt", sizeBytes: 5 });
    await objects.put(
      storageKeys.documentOriginal(workspaceId, body.document.id),
      "hello",
      "text/plain",
    );
    await request(app)
      .post(`/workspaces/${workspaceId}/documents/${body.document.id}/complete`)
      .set("Authorization", bearer(user));
    expect(uploads.pending()).toBe(0);
  });

  it("rejects files it can't index or that are too big", async () => {
    const { app } = setup();
    const user = await signUp(app);
    const workspaceId = await workspaceOf(app, user);
    const create = (filename: string, sizeBytes: number) =>
      request(app)
        .post(`/workspaces/${workspaceId}/documents`)
        .set("Authorization", bearer(user))
        .send({ filename, sizeBytes });
    expect((await create("tool.exe", 10)).status).toBe(400);
    expect((await create("README", 10)).status).toBe(400);
    expect((await create("huge.pdf", 60 * 1024 * 1024)).status).toBe(400);
    expect((await create("empty.txt", 0)).status).toBe(400);
  });
});

describe("document access", () => {
  it("shares documents with the workspace, but only the uploader and admins can delete them", async () => {
    const { app, objects, index } = setup();
    const owner = await signUp(app);
    const member = await signUp(app);
    const outsider = await signUp(app);
    const workspaceId = await workspaceOf(app, owner);
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId, userId: member.auth.user.id, role: "member" });
    const base = `/workspaces/${workspaceId}/documents`;

    const { body } = await request(app)
      .post(base)
      .set("Authorization", bearer(owner))
      .send({ filename: "plan.md", sizeBytes: 4 });
    const documentId = body.document.id as string;
    await objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      "plan",
      "text/markdown",
    );
    await objects.put(storageKeys.documentText(workspaceId, documentId), "plan", "text/plain");
    await index.upsert([
      {
        payload: {
          workspace_id: workspaceId,
          document_id: documentId,
          chunk_index: 0,
          text: "plan",
          filename: "plan.md",
        },
        dense: [1],
        sparse: sparseVector("plan"),
      },
    ]);

    const memberList = await request(app).get(base).set("Authorization", bearer(member));
    expect(memberList.body.documents.map((d: { id: string }) => d.id)).toEqual([documentId]);
    expect((await request(app).get(base).set("Authorization", bearer(outsider))).status).toBe(404);
    expect(
      (await request(app).get(`${base}/${documentId}`).set("Authorization", bearer(outsider)))
        .status,
    ).toBe(404);

    expect(
      (await request(app).delete(`${base}/${documentId}`).set("Authorization", bearer(member)))
        .status,
    ).toBe(403);
    expect(
      (await request(app).delete(`${base}/${documentId}`).set("Authorization", bearer(owner)))
        .status,
    ).toBe(204);

    expect(objects.objects.size).toBe(0);
    expect(index.points.size).toBe(0);
    expect(await ownerDb().select().from(documents).where(eq(documents.id, documentId))).toEqual(
      [],
    );
  });

  it("gives a short-lived download link and re-queues failed documents", async () => {
    const { app, objects, uploads } = setup();
    const user = await signUp(app);
    const workspaceId = await workspaceOf(app, user);
    const base = `/workspaces/${workspaceId}/documents`;
    const { body } = await request(app)
      .post(base)
      .set("Authorization", bearer(user))
      .send({ filename: "a.csv", sizeBytes: 3 });
    const documentId = body.document.id as string;
    await objects.put(storageKeys.documentOriginal(workspaceId, documentId), "a,b", "text/csv");
    await request(app).post(`${base}/${documentId}/complete`).set("Authorization", bearer(user));
    await uploads.delete((await uploads.receive())[0]!.receiptHandle);

    const download = await request(app)
      .get(`${base}/${documentId}/download`)
      .set("Authorization", bearer(user));
    expect(download.body.url).toContain(storageKeys.documentOriginal(workspaceId, documentId));

    const busy = await request(app)
      .post(`${base}/${documentId}/reprocess`)
      .set("Authorization", bearer(user));
    expect(busy.status).toBe(409);
    await ownerDb()
      .update(documents)
      .set({ status: "failed", errorCode: "processing_failed" })
      .where(eq(documents.id, documentId));
    const again = await request(app)
      .post(`${base}/${documentId}/reprocess`)
      .set("Authorization", bearer(user));
    expect(again.body).toMatchObject({ status: "queued", errorCode: null });
    expect(uploads.pending()).toBe(1);
  });
});

describe("search", () => {
  it("finds chunks in the caller's workspace by meaning and keywords, and records the cost", async () => {
    const { app, index } = setup();
    const user = await signUp(app);
    const other = await signUp(app);
    const workspaceId = await workspaceOf(app, user);
    const otherWorkspace = await workspaceOf(app, other);
    const chunk = (workspace: string, documentId: string, text: string) => ({
      payload: {
        workspace_id: workspace,
        document_id: documentId,
        chunk_index: 0,
        text,
        filename: "policy.md",
        page: 3,
      },
      dense: new Array(1536).fill(0.01),
      sparse: sparseVector(text),
    });
    await index.upsert([
      chunk(
        workspaceId,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "The travel policy covers zephyrine trains.",
      ),
      chunk(
        workspaceId,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "Laptops are replaced every three years.",
      ),
      chunk(otherWorkspace, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Their zephyrine secrets."),
    ]);

    const res = await request(app)
      .post(`/workspaces/${workspaceId}/search`)
      .set("Authorization", bearer(user))
      .send({ query: "zephyrine", limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.hits[0]).toMatchObject({
      documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      filename: "policy.md",
      page: 3,
      text: "The travel policy covers zephyrine trains.",
    });
    expect(res.body.hits.map((hit: { text: string }) => hit.text)).not.toContain(
      "Their zephyrine secrets.",
    );

    const ledger = await ownerDb()
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.userId, user.auth.user.id));
    expect(ledger.map((row) => row.feature)).toEqual(["search"]);
  });
});

describe("big uploads in parts", () => {
  const MB = 1024 * 1024;
  function partsSetup() {
    const objects = memoryObjectStore("tessel-test");
    const uploads = memoryUploadQueue();
    const app = createTestApp({
      ai: createTestAi({ gatewayUrl: gateway.url }),
      storage: {
        objects,
        uploads,
        uploadEvents: "api",
        multipart: { thresholdBytes: 10 * MB, partBytes: 5 * MB },
      },
      vectorIndex: memoryVectorIndex(),
    });
    return { app, objects, uploads };
  }

  it("splits a big file into parts, resumes after an interruption, and joins them", async () => {
    const { app, objects, uploads } = partsSetup();
    const user = await signUp(app);
    const base = `/workspaces/${await workspaceOf(app, user)}/documents`;
    const size = 12 * MB;
    const created = await request(app)
      .post(base)
      .set("Authorization", bearer(user))
      .send({ filename: "all-hands.mp4", sizeBytes: size });
    expect(created.status).toBe(201);
    expect(created.body.upload).toBeNull();
    expect(created.body.multipart).toEqual({ partSize: 5 * MB, partCount: 3 });
    const id = created.body.document.id as string;
    const [row] = await ownerDb().select().from(documents).where(eq(documents.id, id));
    const uploadId = row!.uploadId!;
    expect(uploadId).toBeTruthy();

    const urls = await request(app)
      .post(`${base}/${id}/parts`)
      .set("Authorization", bearer(user))
      .send({ partNumbers: [1, 2, 3] });
    expect(urls.body.parts.map((part: { partNumber: number }) => part.partNumber)).toEqual([
      1, 2, 3,
    ]);
    expect(urls.body.parts[0].url).toContain("partNumber=1");
    const tooMany = await request(app)
      .post(`${base}/${id}/parts`)
      .set("Authorization", bearer(user))
      .send({ partNumbers: [4] });
    expect(tooMany.status).toBe(400);

    // Two parts arrive, then the connection drops.
    const bytes = Buffer.alloc(size, 7);
    objects.uploadPart(uploadId, 1, bytes.subarray(0, 5 * MB));
    objects.uploadPart(uploadId, 3, bytes.subarray(10 * MB));
    const early = await request(app)
      .post(`${base}/${id}/complete`)
      .set("Authorization", bearer(user));
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("upload_incomplete");

    // Coming back, the browser asks what's there and sends the rest.
    const resume = await request(app).get(`${base}/${id}/parts`).set("Authorization", bearer(user));
    expect(resume.body).toEqual({
      partSize: 5 * MB,
      partCount: 3,
      uploaded: [
        { partNumber: 1, size: 5 * MB },
        { partNumber: 3, size: 2 * MB },
      ],
    });
    objects.uploadPart(uploadId, 2, bytes.subarray(5 * MB, 10 * MB));

    const done = await request(app)
      .post(`${base}/${id}/complete`)
      .set("Authorization", bearer(user));
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("queued");
    const stored = objects.objects.get(storageKeys.documentOriginal(row!.workspaceId, id))!;
    expect(stored.body.equals(bytes)).toBe(true);
    expect(uploads.pending()).toBe(1);
    const [after] = await ownerDb().select().from(documents).where(eq(documents.id, id));
    expect(after!.uploadId).toBeNull();
  });

  it("only lets the uploader send parts, and cancels the upload when the document is deleted", async () => {
    const { app, objects } = partsSetup();
    const user = await signUp(app);
    const base = `/workspaces/${await workspaceOf(app, user)}/documents`;
    const created = await request(app)
      .post(base)
      .set("Authorization", bearer(user))
      .send({ filename: "lecture.mp3", sizeBytes: 11 * MB });
    const id = created.body.document.id as string;
    expect(objects.multipartUploads.size).toBe(1);

    const stranger = await signUp(app);
    const peek = await request(app)
      .get(`${base}/${id}/parts`)
      .set("Authorization", bearer(stranger));
    expect(peek.status).toBe(404);

    // Small files still go up in one PUT.
    const small = await request(app)
      .post(base)
      .set("Authorization", bearer(user))
      .send({ filename: "notes.md", sizeBytes: 100 });
    expect(small.body.multipart).toBeNull();
    expect(small.body.upload.method).toBe("PUT");

    const removed = await request(app).delete(`${base}/${id}`).set("Authorization", bearer(user));
    expect(removed.status).toBe(204);
    expect(objects.multipartUploads.size).toBe(0);
  });

  it("caps recordings at 500 MB and other files at 50 MB", async () => {
    const { app } = partsSetup();
    const user = await signUp(app);
    const base = `/workspaces/${await workspaceOf(app, user)}/documents`;
    const big = await request(app)
      .post(base)
      .set("Authorization", bearer(user))
      .send({ filename: "notes.pdf", sizeBytes: 60 * MB });
    expect(big.status).toBe(400);
    const recording = await request(app)
      .post(base)
      .set("Authorization", bearer(user))
      .send({ filename: "town-hall.mov", sizeBytes: 400 * MB });
    expect(recording.status).toBe(201);
    expect(recording.body.multipart.partCount).toBe(80);
  });
});
