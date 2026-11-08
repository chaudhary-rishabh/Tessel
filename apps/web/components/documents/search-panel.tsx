"use client";

import type { ApiClientError } from "@tessel/api-client";
import { useApi } from "@tessel/api-client/react";
import type { SearchHit } from "@tessel/contracts";
import { Button } from "@tessel/ui";
import { useMutation } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useId, useState } from "react";
import { chatErrorMessage } from "@/lib/chat-errors";

/** Tries the knowledge base directly: the same hybrid search chat answers will use. */
export function SearchPanel({ workspaceId }: { workspaceId: string }) {
  const api = useApi();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const search = useMutation<SearchHit[], ApiClientError, string>({
    mutationFn: async (text) =>
      (await api.documents.search(workspaceId, { query: text, limit: 8 })).hits,
  });

  return (
    <div>
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) search.mutate(query.trim());
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Search documents
        </label>
        <div className="border-line bg-surface focus-within:border-accent/60 flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3">
          <Search className="text-muted size-4 shrink-0" aria-hidden="true" />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your documents"
            className="h-11 min-w-0 flex-1 bg-transparent text-base focus:outline-none"
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          loading={search.isPending}
          disabled={!query.trim()}
        >
          Search
        </Button>
      </form>

      {search.isError ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {chatErrorMessage(search.error.code, search.error.message)}
        </p>
      ) : null}
      {search.data ? (
        search.data.length === 0 ? (
          <p className="text-muted mt-4 text-sm">
            Nothing matched. Try other words, or wait for documents to finish indexing.
          </p>
        ) : (
          <ol className="mt-4 flex flex-col gap-3" aria-label="Search results">
            {search.data.map((hit) => (
              <li
                key={`${hit.documentId}-${hit.chunkIndex}`}
                className="border-line rounded-xl border p-3.5"
              >
                <p className="text-sm font-medium">
                  {hit.filename}
                  {hit.page ? (
                    <span className="text-muted font-normal">, page {hit.page}</span>
                  ) : null}
                </p>
                <p className="text-muted mt-1 line-clamp-4 text-sm whitespace-pre-line">
                  {hit.text}
                </p>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}
