import { z } from "zod";

/**
 * The parts of an S3 event notification Tessel uses. S3 sends these to SQS
 * when an object is created; in emulator setups the API sends the same shape.
 * https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html
 */
const s3RecordSchema = z.object({
  eventName: z.string(),
  s3: z.object({
    bucket: z.object({ name: z.string() }),
    object: z.object({ key: z.string(), size: z.number().optional() }),
  }),
});

const s3EventSchema = z.object({ Records: z.array(s3RecordSchema) });

export interface ObjectCreatedEvent {
  bucket: string;
  key: string;
  size?: number;
}

/**
 * Object-created records in an SQS message body. Keys arrive URL-encoded,
 * with spaces as "+". Test events and other event types yield nothing.
 */
export function parseObjectCreatedEvents(body: string): ObjectCreatedEvent[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  const parsed = s3EventSchema.safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.Records.filter((record) => record.eventName.startsWith("ObjectCreated:")).map(
    (record) => ({
      bucket: record.s3.bucket.name,
      key: decodeURIComponent(record.s3.object.key.replace(/\+/g, " ")),
      ...(record.s3.object.size === undefined ? {} : { size: record.s3.object.size }),
    }),
  );
}

/** An S3-style notification body, for emulators that can't send their own. */
export function objectCreatedEventBody(event: ObjectCreatedEvent): string {
  return JSON.stringify({
    Records: [
      {
        eventVersion: "2.1",
        eventSource: "aws:s3",
        eventName: "ObjectCreated:Put",
        eventTime: new Date().toISOString(),
        s3: {
          bucket: { name: event.bucket },
          object: {
            key: encodeURIComponent(event.key).replace(/%2F/g, "/").replace(/%20/g, "+"),
            ...(event.size === undefined ? {} : { size: event.size }),
          },
        },
      },
    ],
  });
}
