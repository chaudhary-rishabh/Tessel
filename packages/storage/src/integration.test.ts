import { describe, expect, it } from "vitest";
import { objectCreatedEventBody, parseObjectCreatedEvents } from "./events";
import { createS3ObjectStore } from "./object-store";
import { createSqsUploadQueue } from "./upload-queue";

// Runs against real S3- and SQS-compatible services (the emulators in CI).
const s3Endpoint = process.env.TEST_S3_ENDPOINT;
const sqsEndpoint = process.env.TEST_SQS_ENDPOINT;
const run = Date.now().toString(36);

describe.skipIf(!s3Endpoint)("S3 object store (integration)", () => {
  const store = createS3ObjectStore({
    AWS_REGION: "us-east-1",
    S3_BUCKET: `tessel-test-${run}`,
    S3_ENDPOINT: s3Endpoint,
    S3_FORCE_PATH_STYLE: true,
  });

  it("stores, reads, presigns, and deletes objects", async () => {
    await store.ensureBucket(["http://localhost:3000"]);
    await store.ping();

    await store.put("workspaces/w/a.txt", "hello", "text/plain");
    expect((await store.get("workspaces/w/a.txt")).toString()).toBe("hello");
    expect(await store.head("workspaces/w/a.txt")).toMatchObject({
      size: 5,
      contentType: "text/plain",
    });
    expect(await store.head("workspaces/w/missing")).toBeNull();

    // The browser path: PUT to a presigned URL with the signed type and size.
    const body = "uploaded from a browser";
    const upload = await store.presignUpload("workspaces/w/b.txt", {
      contentType: "text/plain",
      contentLength: Buffer.byteLength(body),
    });
    const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body });
    expect(put.status).toBe(200);
    const download = await fetch(
      await store.presignDownload("workspaces/w/b.txt", { filename: "b.txt" }),
    );
    expect(await download.text()).toBe(body);

    // A different size than the one signed is refused.
    const tooBig = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: `${body}!`,
    });
    expect(tooBig.ok).toBe(false);

    expect(await store.deletePrefix("workspaces/w/")).toBe(2);
    expect(await store.head("workspaces/w/a.txt")).toBeNull();
  });
});

describe.skipIf(!sqsEndpoint)("SQS upload queue (integration)", () => {
  const queue = createSqsUploadQueue({
    AWS_REGION: "us-east-1",
    SQS_ENDPOINT: sqsEndpoint,
    SQS_UPLOADS_QUEUE_URL: `${sqsEndpoint}/000000000000/tessel-test-${run}`,
  });

  it("sends, receives, and deletes upload events", async () => {
    await queue.ensureQueue();
    await queue.ping();
    const event = { bucket: "tessel", key: "workspaces/w/documents/d/original", size: 3 };
    await queue.send(objectCreatedEventBody(event));

    const [message] = await queue.receive({ waitSeconds: 2 });
    expect(message).toBeDefined();
    expect(parseObjectCreatedEvents(message!.body)).toEqual([event]);
    expect(message!.receiveCount).toBe(1);
    await queue.delete(message!.receiptHandle);
    expect(await queue.receive({ waitSeconds: 1 })).toEqual([]);
  });
});
