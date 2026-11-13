"use client";

import { queryKeys, useApi } from "@tessel/api-client/react";
import type { ToolCallView } from "@tessel/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { BookmarkCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "@/lib/toast-store";

/** "Memory updated" under a reply that saved something, with an undo. */
export function MemoryNotes({
  workspaceId,
  calls,
}: {
  workspaceId: string;
  calls: ToolCallView[];
}) {
  const saved = calls.filter(
    (call) =>
      call.name === "remember" && call.status === "completed" && call.undo?.kind === "memory",
  );
  if (saved.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {saved.map((call) => (
        <MemoryNote
          key={call.id}
          workspaceId={workspaceId}
          memoryId={call.undo!.id}
          text={call.summary ?? ""}
        />
      ))}
    </div>
  );
}

function MemoryNote({
  workspaceId,
  memoryId,
  text,
}: {
  workspaceId: string;
  memoryId: string;
  text: string;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"saved" | "undoing" | "undone">("saved");
  return (
    <p className="text-muted flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" role="status">
      <BookmarkCheck className="text-accent size-3.5 shrink-0" aria-hidden="true" />
      {state === "undone" ? (
        <span>Removed from memory.</span>
      ) : (
        <>
          <span className="min-w-0">
            <Link
              href="/settings#memory"
              className="hover:text-ink font-medium underline-offset-2 hover:underline"
            >
              Memory updated
            </Link>
            {text ? `: ${text}` : ""}
          </span>
          <button
            type="button"
            disabled={state === "undoing"}
            onClick={async () => {
              setState("undoing");
              try {
                await api.memory.remove(workspaceId, memoryId);
                setState("undone");
                void queryClient.invalidateQueries({ queryKey: queryKeys.memory(workspaceId) });
              } catch {
                setState("saved");
                toast.error("That memory couldn't be removed. Try again in Settings.");
              }
            }}
            className="text-accent focus-visible:outline-accent rounded font-medium hover:underline focus-visible:outline-2 disabled:opacity-50"
          >
            Undo
          </button>
        </>
      )}
    </p>
  );
}
