"use client";

import { useDocuments } from "@tessel/api-client/react";
import type { DocumentSummary } from "@tessel/contracts";
import { Spinner } from "@tessel/ui";
import { DocumentList } from "@/components/documents/document-list";
import { GraphPanel } from "@/components/documents/graph-panel";
import { SearchPanel } from "@/components/documents/search-panel";
import { UploadZone } from "@/components/documents/upload-zone";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { useSessionStore } from "@/lib/session-store";

export default function DocumentsPage() {
  const { current } = useCurrentWorkspace();
  const user = useSessionStore((state) => state.user);
  const documents = useDocuments(current?.id);
  if (!current) return null;

  const isAdmin = current.role === "owner" || current.role === "admin";
  const canManage = (document: DocumentSummary) => isAdmin || document.uploadedBy === user?.id;
  const readyCount = documents.data?.filter((document) => document.status === "ready").length ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 md:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Documents</h1>
      <p className="text-muted mt-2 max-w-prose">
        Files here are shared with everyone in {current.name} and indexed for search, so answers can
        draw on them.
      </p>

      <section aria-labelledby="upload-heading" className="mt-8">
        <h2 id="upload-heading" className="sr-only">
          Upload
        </h2>
        <UploadZone workspaceId={current.id} />
      </section>

      <section aria-labelledby="files-heading" className="mt-10">
        <h2 id="files-heading" className="text-lg font-semibold">
          Files
        </h2>
        <div className="mt-3">
          {documents.isPending ? (
            <Spinner label="Loading documents" />
          ) : documents.isError ? (
            <p className="text-danger text-sm">
              Documents couldn&apos;t be loaded. Refresh to try again.
            </p>
          ) : documents.data.length === 0 ? (
            <p className="text-muted text-sm">
              No documents yet. Upload a file to start your knowledge base.
            </p>
          ) : (
            <DocumentList
              workspaceId={current.id}
              documents={documents.data}
              canManage={canManage}
            />
          )}
        </div>
      </section>

      {readyCount > 0 ? (
        <section aria-labelledby="search-heading" className="mt-10">
          <h2 id="search-heading" className="text-lg font-semibold">
            Search
          </h2>
          <p className="text-muted mt-1 mb-3 text-sm">
            Finds passages by meaning and by exact words.
          </p>
          <SearchPanel workspaceId={current.id} />
        </section>
      ) : null}

      {readyCount > 0 ? <GraphPanel workspaceId={current.id} /> : null}
    </div>
  );
}
