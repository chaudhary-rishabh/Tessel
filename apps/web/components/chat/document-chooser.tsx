"use client";

import { useDocuments } from "@tessel/api-client/react";
import { Button, Modal, Spinner } from "@tessel/ui";
import { FileText, X } from "lucide-react";
import { useState } from "react";
import { useDocumentScope } from "@/lib/document-scope-store";

/** Picks the documents the next messages search. */
export function DocumentChooser({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const documents = useDocuments(workspaceId);
  const scope = useDocumentScope();
  const [picked, setPicked] = useState(() => new Set(scope.for(workspaceId).map((doc) => doc.id)));
  const ready = (documents.data ?? []).filter((doc) => doc.status === "ready");

  return (
    <Modal label="Choose documents" onClose={onClose}>
      <div className="flex items-center justify-between px-5 pt-5">
        <h2 className="text-lg font-semibold">Choose documents</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent inline-flex size-9 items-center justify-center rounded-md focus-visible:outline-2"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <p className="text-muted px-5 pt-1 text-sm">
        Questions search only these, every time, until you clear them.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {documents.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : ready.length === 0 ? (
          <p className="text-muted px-2 py-8 text-center text-sm">No documents are ready yet.</p>
        ) : (
          <ul aria-label="Documents to search" className="flex flex-col">
            {ready.map((doc) => (
              <li key={doc.id}>
                <label className="hover:bg-ink/4 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2">
                  <input
                    type="checkbox"
                    checked={picked.has(doc.id)}
                    onChange={(event) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(doc.id);
                        else next.delete(doc.id);
                        return next;
                      })
                    }
                    className="accent-accent size-4"
                  />
                  <FileText className="text-muted size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm">{doc.filename}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-line flex justify-end gap-2 border-t px-5 py-3">
        <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
          Clear
        </Button>
        <Button
          size="sm"
          onClick={() => {
            scope.set(
              workspaceId,
              ready
                .filter((doc) => picked.has(doc.id))
                .map((doc) => ({ id: doc.id, filename: doc.filename })),
            );
            onClose();
          }}
        >
          {picked.size === 0
            ? "Search all documents"
            : `Search ${picked.size} document${picked.size === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Modal>
  );
}
