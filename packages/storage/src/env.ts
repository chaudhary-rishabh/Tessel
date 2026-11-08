import { z } from "zod";

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/**
 * File storage and upload event settings, shared by the API and the worker.
 * In production these point at AWS (credentials come from the EC2 instance
 * role); locally and in CI at S3- and SQS-compatible emulators.
 */
export const storageEnvShape = {
  AWS_REGION: z.string().min(1).default("ap-south-1"),
  S3_BUCKET: z.string().min(3),
  /** Emulator endpoint, e.g. http://localhost:8333. Unset for AWS. */
  S3_ENDPOINT: optional(z.url()),
  /** The endpoint browsers use for presigned URLs, when it differs from S3_ENDPOINT. */
  S3_PUBLIC_ENDPOINT: optional(z.url()),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  SQS_UPLOADS_QUEUE_URL: z.url(),
  /** Emulator endpoint, e.g. http://localhost:9324. Unset for AWS. */
  SQS_ENDPOINT: optional(z.url()),
  /**
   * Who announces finished uploads on the SQS queue: S3 bucket notifications
   * ("s3", production) or the API when the browser reports the upload done
   * ("api", for emulators without bucket notifications). The worker handles
   * both the same way.
   */
  UPLOAD_EVENTS: z.enum(["s3", "api"]).default("s3"),
  /** Create the bucket, its CORS rules, and the queue on startup. Emulators only. */
  STORAGE_AUTO_CREATE: z.stringbool().default(false),
};

export const storageEnvSchema = z.object(storageEnvShape);
export type StorageEnv = z.infer<typeof storageEnvSchema>;
