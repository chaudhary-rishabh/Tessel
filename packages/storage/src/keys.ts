/**
 * Object key layout. Every key starts with the workspace ID, so access and
 * deletion can be scoped by prefix.
 *
 *   workspaces/{workspaceId}/documents/{documentId}/original
 *   workspaces/{workspaceId}/documents/{documentId}/parsed.txt
 *   workspaces/{workspaceId}/attachments/{attachmentId}
 *   workspaces/{workspaceId}/media/{mediaId}/original
 *   workspaces/{workspaceId}/media/{mediaId}/preview.webp
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DOCUMENT_ORIGINAL = new RegExp(`^workspaces/(${UUID})/documents/(${UUID})/original$`);

export const storageKeys = {
  documentPrefix: (workspaceId: string, documentId: string) =>
    `workspaces/${workspaceId}/documents/${documentId}/`,
  documentOriginal: (workspaceId: string, documentId: string) =>
    `workspaces/${workspaceId}/documents/${documentId}/original`,
  documentText: (workspaceId: string, documentId: string) =>
    `workspaces/${workspaceId}/documents/${documentId}/parsed.txt`,
  attachment: (workspaceId: string, attachmentId: string) =>
    `workspaces/${workspaceId}/attachments/${attachmentId}`,
  mediaPrefix: (workspaceId: string, mediaId: string) =>
    `workspaces/${workspaceId}/media/${mediaId}/`,
  mediaOriginal: (workspaceId: string, mediaId: string) =>
    `workspaces/${workspaceId}/media/${mediaId}/original`,
  mediaPreview: (workspaceId: string, mediaId: string) =>
    `workspaces/${workspaceId}/media/${mediaId}/preview.webp`,
};

/** The workspace and document an uploaded original belongs to, or null for any other key. */
export function parseDocumentKey(key: string): { workspaceId: string; documentId: string } | null {
  const match = DOCUMENT_ORIGINAL.exec(key);
  return match ? { workspaceId: match[1]!, documentId: match[2]! } : null;
}
