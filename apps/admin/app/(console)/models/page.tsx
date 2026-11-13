"use client";

import { toApiClientError } from "@tessel/api-client";
import { useApi } from "@tessel/api-client/react";
import type { AdminModel, AdminModels, AdminModelsResponse } from "@tessel/contracts";
import { Button, Spinner } from "@tessel/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ErrorText, PageHeader } from "@/components/page-header";
import { dateTime } from "@/lib/format";

const inputClass =
  "border-line bg-surface focus:border-accent focus:outline-accent/25 h-9 rounded-lg border px-2 text-sm focus:outline-2";

function DefaultSelect({
  role,
  label,
  draft,
  onChange,
}: {
  role: "chat" | "utility" | "moderation" | "voice";
  label: string;
  draft: AdminModels;
  onChange: (id: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={draft.defaults[role] ?? draft.defaults.chat}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        {draft.models
          .filter((model) => model.kind === "chat" && model.enabled)
          .map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
      </select>
    </div>
  );
}

function ModelRow({
  model,
  onChange,
}: {
  model: AdminModel;
  onChange: (model: AdminModel) => void;
}) {
  const price = (key: "input" | "output") => (
    <input
      type="number"
      min={0}
      step="0.01"
      aria-label={`${model.label} ${key} price per million tokens`}
      value={model.pricing[key]}
      onChange={(event) =>
        onChange({ ...model, pricing: { ...model.pricing, [key]: Number(event.target.value) } })
      }
      className={`${inputClass} w-20`}
    />
  );
  return (
    <tr>
      <td className="px-3 py-2.5">
        <input
          aria-label={`Label for ${model.id}`}
          value={model.label}
          onChange={(event) => onChange({ ...model, label: event.target.value })}
          className={`${inputClass} w-44`}
        />
        <p className="text-muted mt-1 text-xs break-all">{model.id}</p>
      </td>
      <td className="text-muted px-3 py-2.5">{model.kind}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {price("input")}
          <span className="text-muted">/</span>
          {price("output")}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <select
          aria-label={`Plan for ${model.label}`}
          value={model.tier}
          onChange={(event) =>
            onChange({ ...model, tier: event.target.value as AdminModel["tier"] })
          }
          className={inputClass}
        >
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </select>
      </td>
      <td className="px-3 py-2.5 text-center">
        <input
          type="checkbox"
          aria-label={`Show ${model.label} in the model picker`}
          checked={model.selectable}
          disabled={model.kind !== "chat"}
          onChange={(event) => onChange({ ...model, selectable: event.target.checked })}
          className="size-4"
        />
      </td>
      <td className="px-3 py-2.5 text-center">
        <input
          type="checkbox"
          aria-label={`${model.label} enabled`}
          checked={model.enabled}
          onChange={(event) => onChange({ ...model, enabled: event.target.checked })}
          className="size-4"
        />
      </td>
    </tr>
  );
}

export default function ModelsPage() {
  const api = useApi();
  const models = useQuery({ queryKey: ["admin", "models"], queryFn: api.admin.models });
  if (models.isPending) return <Spinner label="Loading models" />;
  if (models.isError) return <ErrorText>{toApiClientError(models.error).message}</ErrorText>;
  return <ModelsEditor current={models.data} />;
}

/** Edits a copy of the registry; nothing changes until it's saved. */
function ModelsEditor({ current }: { current: AdminModelsResponse }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AdminModels>({
    defaults: current.defaults,
    models: current.models,
  });
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (input: AdminModels) => api.admin.saveModels(input),
    onSuccess: (result) => {
      queryClient.setQueryData(["admin", "models"], result);
      setSaved(true);
    },
  });

  const update = (next: AdminModels) => {
    setDraft(next);
    setSaved(false);
  };
  const embedding = draft.models.find((model) => model.id === draft.defaults.embedding);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Models"
        description="Which models people can use, what they cost, and the defaults. Saving applies to every API and worker within a minute."
        actions={
          <Button loading={save.isPending} onClick={() => save.mutate(draft)}>
            Save changes
          </Button>
        }
      />
      <p className="text-muted mt-2 text-xs">
        {current.source === "saved"
          ? `Last saved ${dateTime(current.updatedAt)}.`
          : "Using the bundled models.json until you save."}
      </p>
      <div className="mt-4" aria-live="polite">
        {save.error ? <ErrorText>{toApiClientError(save.error).message}</ErrorText> : null}
        {saved && !save.error ? (
          <p className="text-accent text-sm">Saved. The registry is updated.</p>
        ) : null}
      </div>

      <section aria-labelledby="defaults-heading" className="mt-6">
        <h2 id="defaults-heading" className="text-lg font-semibold">
          Defaults
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DefaultSelect
            role="chat"
            label="Chat"
            draft={draft}
            onChange={(id) => update({ ...draft, defaults: { ...draft.defaults, chat: id } })}
          />
          <DefaultSelect
            role="utility"
            label="Background work"
            draft={draft}
            onChange={(id) => update({ ...draft, defaults: { ...draft.defaults, utility: id } })}
          />
          <DefaultSelect
            role="moderation"
            label="Moderation"
            draft={draft}
            onChange={(id) => update({ ...draft, defaults: { ...draft.defaults, moderation: id } })}
          />
          <DefaultSelect
            role="voice"
            label="Voice"
            draft={draft}
            onChange={(id) => update({ ...draft, defaults: { ...draft.defaults, voice: id } })}
          />
        </div>
        <p className="text-muted mt-3 text-xs">
          Embeddings use {embedding?.label ?? draft.defaults.embedding}. Changing that needs every
          document re-indexed, so it&apos;s set in models.json instead.
        </p>
      </section>

      <section aria-labelledby="models-heading" className="mt-8">
        <h2 id="models-heading" className="text-lg font-semibold">
          All models
        </h2>
        <p className="text-muted mt-1 text-xs">
          Prices are US dollars per million input / output tokens.
        </p>
        <div className="border-line mt-3 overflow-x-auto rounded-xl border">
          <table className="figures bg-surface w-full min-w-[46rem] text-left text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Model
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Kind
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Price
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Plan
                </th>
                <th scope="col" className="px-3 py-2.5 text-center font-medium">
                  In picker
                </th>
                <th scope="col" className="px-3 py-2.5 text-center font-medium">
                  Enabled
                </th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y" aria-label="Models">
              {draft.models.map((model, index) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  onChange={(next) =>
                    update({
                      ...draft,
                      models: draft.models.map((item, at) => (at === index ? next : item)),
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
