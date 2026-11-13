"use client";

import { useApi } from "@tessel/api-client/react";
import type { AdminVoiceResponse } from "@tessel/contracts";
import { cn, Spinner } from "@tessel/ui";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { count } from "@/lib/format";

const ms = (value: number | null) => (value === null ? "–" : `${count(value)} ms`);
const percent = (share: number) => `${Math.round(share * 100)}%`;

function Figure({
  label,
  value,
  note,
  good,
}: {
  label: string;
  value: string;
  note?: string;
  /** Colours the value: met the target, missed it, or neutral. */
  good?: boolean | undefined;
}) {
  return (
    <div className="border-line bg-surface rounded-xl border p-4">
      <p className="text-muted text-sm">{label}</p>
      <p
        className={cn(
          "figures font-display mt-1 text-2xl font-semibold",
          good === true && "text-accent",
          good === false && "text-danger",
        )}
      >
        {value}
      </p>
      {note ? <p className="text-muted mt-0.5 text-xs">{note}</p> : null}
    </div>
  );
}

/** Where the median reply's time goes, stage by stage. */
function Stages({ data }: { data: AdminVoiceResponse }) {
  const stages = [
    { label: "End of turn", value: data.stages.endOfTurnMs, tone: "bg-tile-moss" },
    { label: "Model's first words", value: data.stages.modelFirstTokenMs, tone: "bg-tile-iris" },
    { label: "First audio", value: data.stages.firstAudioMs, tone: "bg-tile-ochre" },
  ];
  const total = stages.reduce((sum, stage) => sum + (stage.value ?? 0), 0);
  if (total === 0) return null;
  return (
    <section aria-labelledby="stages" className="mt-10">
      <h2 id="stages" className="text-lg font-semibold">
        Where the time goes
      </h2>
      <p className="text-muted text-sm">
        The median of each stage. Preemptive replies overlap them, so the total can be shorter.
      </p>
      <div className="mt-4 flex h-6 overflow-hidden rounded-md" aria-hidden="true">
        {stages.map((stage) => (
          <div
            key={stage.label}
            className={stage.tone}
            style={{ width: `${((stage.value ?? 0) / total) * 100}%` }}
          />
        ))}
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {stages.map((stage) => (
          <div key={stage.label} className="flex items-center gap-2">
            <span className={cn("size-2.5 rounded-sm", stage.tone)} aria-hidden="true" />
            <dt className="text-muted">{stage.label}</dt>
            <dd className="figures font-medium">{ms(stage.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Each day's median and 95th percentile against the target line. */
function Daily({ data }: { data: AdminVoiceResponse }) {
  if (data.days.length === 0) return null;
  const top = Math.max(data.targetMs * 1.5, ...data.days.map((day) => day.p95Ms));
  const y = (value: number) => `${(value / top) * 100}%`;
  return (
    <section aria-labelledby="daily" className="mt-10">
      <h2 id="daily" className="text-lg font-semibold">
        By day
      </h2>
      <p className="text-muted text-sm">
        Bars are the median; the tick above each is the 95th percentile. The line is the{" "}
        {count(data.targetMs)} ms target.
      </p>
      <div className="relative mt-4 h-40" aria-hidden="true">
        <div
          className="border-danger/60 absolute inset-x-0 border-t border-dashed"
          style={{ bottom: y(data.targetMs) }}
        />
        <div className="flex h-full items-end gap-1">
          {data.days.map((day) => (
            <div
              key={day.day}
              className="relative h-full min-w-1 flex-1"
              title={`${day.day}: median ${day.p50Ms} ms, 95th ${day.p95Ms} ms, ${day.turns} replies`}
            >
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 rounded-t",
                  day.p50Ms <= data.targetMs ? "bg-accent" : "bg-danger",
                )}
                style={{ height: y(day.p50Ms) }}
              />
              <div className="bg-ink absolute inset-x-0 h-0.5" style={{ bottom: y(day.p95Ms) }} />
            </div>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>Voice latency by day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Median</th>
            <th scope="col">95th percentile</th>
            <th scope="col">Replies</th>
          </tr>
        </thead>
        <tbody>
          {data.days.map((day) => (
            <tr key={day.day}>
              <td>{day.day}</td>
              <td>{day.p50Ms} ms</td>
              <td>{day.p95Ms} ms</td>
              <td>{day.turns}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function VoicePage() {
  const api = useApi();
  const periodId = useId();
  const [days, setDays] = useState(7);
  const voice = useQuery({
    queryKey: ["admin", "voice", days],
    queryFn: () => api.admin.voice(days),
  });
  const data = voice.data;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Voice"
        description="How quickly Tessel answers in voice conversations: from the end of someone's speech to its first sound."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor={periodId} className="text-sm font-medium">
              Period
            </label>
            <select
              id={periodId}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="border-line bg-surface h-9 rounded-lg border px-2 text-sm"
            >
              <option value={1}>24 hours</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
        }
      />
      {!data ? (
        <div className="mt-8">
          <Spinner label="Loading voice latency" />
        </div>
      ) : data.turns === 0 ? (
        <p className="text-muted mt-8">No voice conversations in this period.</p>
      ) : (
        <>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              label="Median reply"
              value={ms(data.p50Ms)}
              note={`Target ${count(data.targetMs)} ms`}
              good={data.p50Ms === null ? undefined : data.p50Ms <= data.targetMs}
            />
            <Figure
              label="95th percentile"
              value={ms(data.p95Ms)}
              note="Target 900 ms"
              good={data.p95Ms === null ? undefined : data.p95Ms <= 900}
            />
            <Figure
              label="Within target"
              value={percent(data.withinTarget)}
              note={`${percent(data.preemptive)} drafted early, ${percent(data.interrupted)} interrupted`}
            />
            <Figure
              label="Conversations"
              value={count(data.sessions)}
              note={`${count(data.turns)} replies, ${count(Math.round(data.userAudioMinutes))} minutes heard`}
            />
          </div>
          <Stages data={data} />
          <Daily data={data} />
        </>
      )}
    </div>
  );
}
