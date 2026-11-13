import type { ObjectInfo, ObjectStore, UploadedPart } from "./object-store";
import type { QueueMessage, UploadEventQueue } from "./upload-queue";

/** Object storage in memory, for tests. Presigned URLs point at a fake host. */
export function memoryObjectStore(bucket = "test-bucket"): ObjectStore & {
  objects: Map<string, { body: Buffer; info: ObjectInfo }>;
  /** What a browser's PUT to a part URL would do. */
  uploadPart(uploadId: string, partNumber: number, body: Buffer): void;
  multipartUploads: Map<string, { key: string; contentType: string; parts: Map<number, Buffer> }>;
} {
  const objects = new Map<string, { body: Buffer; info: ObjectInfo }>();
  const multipartUploads = new Map<
    string,
    { key: string; contentType: string; parts: Map<number, Buffer> }
  >();
  let uploads = 0;
  const upload = (uploadId: string) => {
    const found = multipartUploads.get(uploadId);
    if (!found) throw Object.assign(new Error("No such upload"), { name: "NoSuchUpload" });
    return found;
  };
  return {
    bucket,
    objects,
    multipartUploads,
    uploadPart: (uploadId, partNumber, body) => {
      upload(uploadId).parts.set(partNumber, body);
    },
    createMultipart: async (key, contentType) => {
      const uploadId = `upload-${++uploads}`;
      multipartUploads.set(uploadId, { key, contentType, parts: new Map() });
      return { uploadId };
    },
    presignPart: async (key, uploadId, partNumber) =>
      `https://storage.test/${bucket}/${key}?uploadId=${uploadId}&partNumber=${partNumber}`,
    listParts: async (_key, uploadId) =>
      [...upload(uploadId).parts.entries()]
        .sort(([a], [b]) => a - b)
        .map(([partNumber, body]): UploadedPart => ({
          partNumber,
          size: body.length,
          etag: `"etag-${partNumber}"`,
        })),
    completeMultipart: async (key, uploadId, parts) => {
      const found = upload(uploadId);
      const body = Buffer.concat(parts.map((part) => found.parts.get(part.partNumber)!));
      objects.set(key, {
        body,
        info: { size: body.length, contentType: found.contentType, metadata: {} },
      });
      multipartUploads.delete(uploadId);
    },
    abortMultipart: async (_key, uploadId) => {
      multipartUploads.delete(uploadId);
    },
    put: async (key, body, contentType) => {
      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
      objects.set(key, { body: buffer, info: { size: buffer.length, contentType, metadata: {} } });
    },
    get: async (key) => {
      const object = objects.get(key);
      if (!object) throw Object.assign(new Error(`No such key: ${key}`), { name: "NoSuchKey" });
      return object.body;
    },
    head: async (key) => objects.get(key)?.info ?? null,
    deletePrefix: async (prefix) => {
      let deleted = 0;
      for (const key of [...objects.keys()]) {
        if (key.startsWith(prefix)) {
          objects.delete(key);
          deleted += 1;
        }
      }
      return deleted;
    },
    presignUpload: async (key, { contentType, expiresInSeconds = 900 }) => ({
      url: `https://storage.test/${bucket}/${key}?signature=test`,
      method: "PUT",
      headers: { "Content-Type": contentType },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    }),
    presignDownload: async (key) => `https://storage.test/${bucket}/${key}?download=test`,
    ping: async () => undefined,
  };
}

/** An SQS-like queue in memory: messages stay until deleted, and are redelivered after the visibility timeout. */
export function memoryUploadQueue(): UploadEventQueue & { pending: () => number } {
  let counter = 0;
  const messages = new Map<
    string,
    { body: string; receiveCount: number; invisibleUntil: number }
  >();
  return {
    pending: () => messages.size,
    send: async (body) => {
      counter += 1;
      messages.set(`m${counter}`, { body, receiveCount: 0, invisibleUntil: 0 });
    },
    receive: async ({ maxMessages = 10 } = {}) => {
      // Yield to the event loop like a network call would.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const now = Date.now();
      const out: QueueMessage[] = [];
      for (const [handle, message] of messages) {
        if (out.length >= maxMessages) break;
        if (message.invisibleUntil > now) continue;
        message.receiveCount += 1;
        message.invisibleUntil = now + 30_000;
        out.push({ body: message.body, receiptHandle: handle, receiveCount: message.receiveCount });
      }
      return out;
    },
    delete: async (handle) => {
      messages.delete(handle);
    },
    ping: async () => undefined,
  };
}
