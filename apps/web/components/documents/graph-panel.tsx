"use client";

import { useGraph } from "@tessel/api-client/react";
import type { GraphFactView } from "@tessel/contracts";
import { Button, Spinner } from "@tessel/ui";
import { ArrowRight, Network } from "lucide-react";
import { useState, type FormEvent } from "react";

const readable = (type: string) => type.toLowerCase().replace(/_/g, " ");

function FactRow({ fact }: { fact: GraphFactView }) {
  return (
    <li className="py-2.5 text-sm">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <span className="font-medium">{fact.source}</span>
        <span className="text-muted inline-flex items-center gap-1">
          <ArrowRight className="size-3.5" aria-hidden="true" />
          {readable(fact.type)}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </span>
        <span className="font-medium">{fact.target}</span>
      </p>
      <p className="text-muted mt-0.5 text-xs">
        {fact.description ? `${fact.description} ` : ""}From {fact.filename}
      </p>
    </li>
  );
}

/**
 * The knowledge graph Tessel builds from the documents: how people, teams,
 * projects, and systems connect. Answers use it for relationship questions.
 */
export function GraphPanel({ workspaceId }: { workspaceId: string }) {
  const [draft, setDraft] = useState("");
  const [entity, setEntity] = useState("");
  const overview = useGraph(workspaceId);
  const result = useGraph(workspaceId, entity);

  if (!overview.data?.enabled) return null;
  const { counts } = overview.data;

  function submit(event: FormEvent) {
    event.preventDefault();
    setEntity(draft.trim());
  }

  return (
    <section aria-labelledby="graph-heading" className="mt-10">
      <h2 id="graph-heading" className="flex items-center gap-2 text-lg font-semibold">
        <Network className="text-muted size-5" aria-hidden="true" />
        Connections
      </h2>
      <p className="text-muted mt-1 text-sm">
        {counts.entities
          ? `Tessel found ${counts.entities} people, teams, and other things, with ${counts.relations} connections between them, in your documents.`
          : "As documents are indexed, Tessel maps the people, teams, and projects in them and how they connect."}
      </p>
      {counts.entities ? (
        <>
          <form onSubmit={submit} className="mt-3 flex gap-2">
            <label className="sr-only" htmlFor="graph-entity">
              Find connections
            </label>
            <input
              id="graph-entity"
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="A person, team, or project"
              className="border-line bg-surface focus:border-accent focus:outline-accent/25 h-11 min-w-0 flex-1 rounded-lg border px-3 text-base focus:outline-2"
            />
            <Button type="submit" variant="secondary" disabled={!draft.trim()}>
              Find connections
            </Button>
          </form>
          {entity ? (
            <div className="mt-3">
              {result.isPending ? (
                <Spinner label="Finding connections" />
              ) : result.data?.facts.length ? (
                <ul className="divide-line border-line divide-y border-y" aria-label="Connections">
                  {result.data.facts.map((fact, index) => (
                    <FactRow
                      key={`${fact.source}-${fact.type}-${fact.target}-${index}`}
                      fact={fact}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-muted text-sm">
                  No connections found for &ldquo;{entity}&rdquo;.
                </p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
