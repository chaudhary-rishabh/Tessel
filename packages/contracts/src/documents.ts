import { z } from "zod";

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
/** Recordings are transcribed, so they can be bigger: about two hours of video. */
export const MAX_RECORDING_BYTES = 500 * 1024 * 1024;

/** Audio and video, which are transcribed into text, by extension. */
export const RECORDING_TYPES = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  opus: "audio/opus",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
} as const;

/** Whether a stored media type is a recording to transcribe. */
export const isRecording = (mediaType: string) =>
  mediaType.startsWith("audio/") || mediaType.startsWith("video/");

/** The largest upload allowed for a file name. */
export function maxUploadBytes(filename: string): number {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(RECORDING_TYPES, extension) ? MAX_RECORDING_BYTES : MAX_DOCUMENT_BYTES;
}

/** File types the ingestion pipeline can read, by extension. */
export const DOCUMENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  ...RECORDING_TYPES,
} as const;

export const documentStatusSchema = z.enum([
  "uploading",
  "queued",
  "processing",
  "ready",
  "failed",
]);

export const documentSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  mediaType: z.string(),
  sizeBytes: z.number().int(),
  status: documentStatusSchema,
  errorCode: z.string().nullable(),
  pageCount: z.number().int().nullable(),
  chunkCount: z.number().int().nullable(),
  uploadedBy: z.uuid(),
  createdAt: z.iso.datetime(),
  processedAt: z.iso.datetime().nullable(),
});

export const documentListResponseSchema = z.object({ documents: z.array(documentSchema) });

export const createDocumentRequestSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((name) => {
        const extension = name.split(".").pop()?.toLowerCase() ?? "";
        return name.includes(".") && Object.hasOwn(DOCUMENT_TYPES, extension);
      }, "Upload a PDF, Word (.docx), text, Markdown, CSV, JSON, or HTML file, or an audio or video recording"),
    sizeBytes: z.number().int().min(1, "The file is empty"),
  })
  .superRefine(({ filename, sizeBytes }, ctx) => {
    const max = maxUploadBytes(filename);
    if (sizeBytes > max) {
      ctx.addIssue({
        code: "custom",
        path: ["sizeBytes"],
        message:
          max === MAX_RECORDING_BYTES
            ? "Recordings can be up to 500 MB"
            : "Files can be up to 50 MB",
      });
    }
  });

export const presignedUploadSchema = z.object({
  url: z.url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});

export const createDocumentResponseSchema = z.object({
  document: documentSchema,
  upload: presignedUploadSchema,
});

export const documentParamsSchema = z.object({
  workspaceId: z.uuid("Invalid workspace ID"),
  documentId: z.uuid("Invalid document ID"),
});

export const downloadResponseSchema = z.object({ url: z.url() });

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1, "Enter something to search for").max(2_000),
  limit: z.number().int().min(1).max(50).default(10),
  documentIds: z.array(z.uuid()).max(100).optional(),
});

export const searchHitSchema = z.object({
  documentId: z.uuid(),
  filename: z.string(),
  chunkIndex: z.number().int(),
  page: z.number().int().nullable(),
  text: z.string(),
  score: z.number(),
});

export const searchResponseSchema = z.object({ hits: z.array(searchHitSchema) });

export type DocumentSummary = z.infer<typeof documentSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;
export type CreateDocumentResponse = z.infer<typeof createDocumentResponseSchema>;
export type PresignedUpload = z.infer<typeof presignedUploadSchema>;
export type SearchRequest = z.input<typeof searchRequestSchema>;
export type SearchHit = z.infer<typeof searchHitSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** The media type Tessel stores for a filename, from its extension. */
export function documentMediaType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return (DOCUMENT_TYPES as Record<string, string>)[extension] ?? "application/octet-stream";
}

/** A document's extracted text, for outside clients that read documents. */
export const documentTextResponseSchema = z.object({
  documentId: z.uuid(),
  filename: z.string(),
  text: z.string(),
  /** True when the text was cut at the requested length. */
  truncated: z.boolean(),
  characterCount: z.number().int(),
});

export const documentTextQuerySchema = z.object({
  maxCharacters: z.coerce.number().int().min(1_000).max(200_000).default(50_000),
});

export type DocumentTextResponse = z.infer<typeof documentTextResponseSchema>;

/** A relationship in the knowledge graph built from a workspace's documents. */
export const graphFactSchema = z.object({
  source: z.string(),
  sourceType: z.string(),
  type: z.string(),
  target: z.string(),
  targetType: z.string(),
  description: z.string(),
  documentId: z.string(),
  filename: z.string(),
  chunkIndex: z.number().int(),
});

export const graphOverviewSchema = z.object({
  /** False when the knowledge graph isn't set up on this server. */
  enabled: z.boolean(),
  counts: z.object({ entities: z.number().int(), relations: z.number().int() }),
  entities: z.array(
    z.object({ key: z.string(), name: z.string(), type: z.string(), description: z.string() }),
  ),
  facts: z.array(graphFactSchema),
});

export type GraphFactView = z.infer<typeof graphFactSchema>;
export type GraphOverview = z.infer<typeof graphOverviewSchema>;
