import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  UploadPartCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageEnv } from "./env";

export interface ObjectInfo {
  size: number;
  contentType?: string;
  metadata: Record<string, string>;
}

export interface PresignedUpload {
  url: string;
  method: "PUT";
  /** Headers the upload must send exactly; they are part of the signature. */
  headers: Record<string, string>;
  expiresAt: string;
}

/** One finished part of a multipart upload. */
export interface UploadedPart {
  partNumber: number;
  size: number;
  etag: string;
}

/** The storage operations Tessel needs, so tests can swap in memory storage. */
export interface ObjectStore {
  readonly bucket: string;
  put(key: string, body: Buffer | string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Size, type, and metadata, or null if the object doesn't exist. */
  head(key: string): Promise<ObjectInfo | null>;
  /** Deletes every object under a prefix. */
  deletePrefix(prefix: string): Promise<number>;
  /** A URL the browser can PUT one file to, with its size and type fixed by the signature. */
  presignUpload(
    key: string,
    options: { contentType: string; contentLength: number; expiresInSeconds?: number },
  ): Promise<PresignedUpload>;
  /** A short-lived download URL that saves the file under its original name. */
  presignDownload(
    key: string,
    options: { filename: string; expiresInSeconds?: number },
  ): Promise<string>;
  /** Cheap request that fails when the bucket is unreachable, for readiness checks. */
  ping(): Promise<void>;
  /**
   * Multipart uploads, for big files: the browser PUTs each part to its own
   * presigned URL (and can resume), then the parts are joined into one object.
   */
  createMultipart(key: string, contentType: string): Promise<{ uploadId: string }>;
  presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    options?: { expiresInSeconds?: number },
  ): Promise<string>;
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  completeMultipart(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

const isNotFound = (error: unknown) =>
  error instanceof S3ServiceException &&
  (error.name === "NotFound" ||
    error.name === "NoSuchKey" ||
    error.$metadata.httpStatusCode === 404);

const contentDisposition = (filename: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;

export function createS3ObjectStore(
  env: Pick<
    StorageEnv,
    "AWS_REGION" | "S3_BUCKET" | "S3_ENDPOINT" | "S3_PUBLIC_ENDPOINT" | "S3_FORCE_PATH_STYLE"
  >,
): ObjectStore & { ensureBucket(corsOrigins: string[]): Promise<void>; client: S3Client } {
  const base = {
    region: env.AWS_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    // Only send checksums S3 requires; emulators and presigned browser uploads
    // don't handle the SDK's default CRC32 headers well.
    requestChecksumCalculation: "WHEN_REQUIRED" as const,
    responseChecksumValidation: "WHEN_REQUIRED" as const,
  };
  const client = new S3Client({
    ...base,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  });
  // Presigned URLs are opened by browsers, which may reach storage at a different address.
  const publicEndpoint = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
  const signer = new S3Client({ ...base, ...(publicEndpoint ? { endpoint: publicEndpoint } : {}) });
  const Bucket = env.S3_BUCKET;

  return {
    bucket: Bucket,
    client,

    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!response.Body) throw new Error(`Object ${key} has no body`);
      return Buffer.from(await response.Body.transformToByteArray());
    },

    async head(key) {
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          size: response.ContentLength ?? 0,
          ...(response.ContentType ? { contentType: response.ContentType } : {}),
          metadata: response.Metadata ?? {},
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async deletePrefix(prefix) {
      let deleted = 0;
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix: prefix,
            ...(token ? { ContinuationToken: token } : {}),
          }),
        );
        const keys = (page.Contents ?? []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []));
        if (keys.length > 0) {
          await client.send(
            new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }),
          );
          deleted += keys.length;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return deleted;
    },

    async presignUpload(key, { contentType, contentLength, expiresInSeconds = 900 }) {
      const url = await getSignedUrl(
        signer,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: contentLength,
        }),
        {
          expiresIn: expiresInSeconds,
          signableHeaders: new Set(["content-type", "content-length"]),
        },
      );
      return {
        url,
        method: "PUT",
        headers: { "Content-Type": contentType },
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      };
    },

    async presignDownload(key, { filename, expiresInSeconds = 300 }) {
      return getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: contentDisposition(filename),
        }),
        { expiresIn: expiresInSeconds },
      );
    },

    async createMultipart(key, contentType) {
      const result = await client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }),
      );
      if (!result.UploadId) throw new Error("Storage didn't start the multipart upload");
      return { uploadId: result.UploadId };
    },

    async presignPart(key, uploadId, partNumber, { expiresInSeconds = 3600 } = {}) {
      return getSignedUrl(
        signer,
        new UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: expiresInSeconds },
      );
    },

    async listParts(key, uploadId) {
      const parts: UploadedPart[] = [];
      let marker: string | undefined;
      do {
        const page = await client.send(
          new ListPartsCommand({ Bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
        );
        for (const part of page.Parts ?? []) {
          if (part.PartNumber && part.ETag) {
            parts.push({ partNumber: part.PartNumber, size: part.Size ?? 0, etag: part.ETag });
          }
        }
        marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
      } while (marker);
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    },

    async completeMultipart(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }),
      );
    },

    async abortMultipart(key, uploadId) {
      await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
    },

    async ping() {
      // A one-key listing under the app's prefix: the instance role may only
      // list there, and HeadBucket would need listing the whole bucket.
      await client.send(new ListObjectsV2Command({ Bucket, Prefix: "workspaces/", MaxKeys: 1 }));
    },

    async ensureBucket(corsOrigins) {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket }));
      }
      // Browsers upload straight to storage, so the bucket must allow the web origins.
      // Some emulators allow every origin and don't implement this call.
      try {
        await client.send(
          new PutBucketCorsCommand({
            Bucket,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: corsOrigins,
                  AllowedMethods: ["PUT", "GET"],
                  AllowedHeaders: ["*"],
                  ExposeHeaders: ["ETag"],
                  MaxAgeSeconds: 3600,
                },
              ],
            },
          }),
        );
      } catch (error) {
        if (!env.S3_ENDPOINT) throw error;
      }
    },
  };
}
