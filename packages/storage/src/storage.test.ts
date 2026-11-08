import { describe, expect, it } from "vitest";
import { objectCreatedEventBody, parseObjectCreatedEvents } from "./events";
import { parseDocumentKey, storageKeys } from "./keys";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";

describe("storage keys", () => {
  it("puts every key under its workspace and reads document keys back", () => {
    const key = storageKeys.documentOriginal(workspaceId, documentId);
    expect(key).toBe(`workspaces/${workspaceId}/documents/${documentId}/original`);
    expect(key.startsWith(storageKeys.documentPrefix(workspaceId, documentId))).toBe(true);
    expect(parseDocumentKey(key)).toEqual({ workspaceId, documentId });
    expect(parseDocumentKey(storageKeys.documentText(workspaceId, documentId))).toBeNull();
    expect(parseDocumentKey(`workspaces/../documents/${documentId}/original`)).toBeNull();
  });
});

describe("S3 events", () => {
  it("reads object-created records, decoding keys the way S3 encodes them", () => {
    const body = JSON.stringify({
      Records: [
        {
          eventName: "ObjectCreated:Put",
          s3: { bucket: { name: "tessel" }, object: { key: "a/my+file%28v2%29.txt", size: 12 } },
        },
        {
          eventName: "ObjectRemoved:Delete",
          s3: { bucket: { name: "tessel" }, object: { key: "b" } },
        },
      ],
    });
    expect(parseObjectCreatedEvents(body)).toEqual([
      { bucket: "tessel", key: "a/my file(v2).txt", size: 12 },
    ]);
  });

  it("ignores test events and junk", () => {
    expect(
      parseObjectCreatedEvents(JSON.stringify({ Event: "s3:TestEvent", Service: "Amazon S3" })),
    ).toEqual([]);
    expect(parseObjectCreatedEvents("not json")).toEqual([]);
  });

  it("round-trips the events the API sends for emulators", () => {
    const event = {
      bucket: "tessel",
      key: storageKeys.documentOriginal(workspaceId, documentId),
      size: 99,
    };
    expect(parseObjectCreatedEvents(objectCreatedEventBody(event))).toEqual([event]);
  });
});
