"use client";

import type { ArtifactBlock } from "@tessel/contracts";
import { cn } from "@tessel/ui";
import { useArtifactPanel } from "@/lib/artifact-store";
import { ARTIFACT_ICONS, artifactKind } from "./artifact-panel";

/**
 * Where an artifact sits in a reply: a card that opens it beside the chat,
 * at the version this reply wrote.
 */
export function ArtifactCard({
  threadKey,
  artifact,
  version,
}: {
  threadKey: string;
  artifact: ArtifactBlock;
  /** Which version of the artifact this reply wrote. */
  version: number;
}) {
  const panel = useArtifactPanel();
  const open =
    panel.threadKey === threadKey &&
    panel.identifier === artifact.identifier &&
    (panel.version === version || panel.version === null);
  const Icon = ARTIFACT_ICONS[artifact.type];
  return (
    <button
      type="button"
      onClick={() => panel.open(threadKey, artifact.identifier, version)}
      aria-pressed={open}
      className={cn(
        "border-line bg-surface hover:border-accent/60 focus-visible:outline-accent my-3 flex w-full max-w-md items-center gap-3 rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-2",
        open && "border-accent/70",
      )}
    >
      <span className="bg-paper border-line grid size-11 shrink-0 place-items-center rounded-lg border">
        <Icon className="text-accent size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{artifact.title}</span>
        <span className="text-muted block truncate text-xs">
          {artifact.complete
            ? `${artifactKind(artifact)}${version > 1 ? ` · version ${version}` : ""}`
            : "Writing…"}
        </span>
      </span>
      {!artifact.complete ? (
        <span
          className="bg-accent size-2 shrink-0 rounded-full motion-safe:animate-[pulse-dot_1.2s_ease-in-out_infinite]"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}
