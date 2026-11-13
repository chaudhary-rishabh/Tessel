"use client";

import { ApiClientError } from "@tessel/api-client";
import { queryKeys, useApi, useSkills } from "@tessel/api-client/react";
import type { Skill } from "@tessel/contracts";
import { MAX_SKILL_FILE_BYTES } from "@tessel/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;

/** A skill's reference files and templates: text files the agent reads when the skill says to. */
export function SkillFiles({ workspaceId, skill: initial }: { workspaceId: string; skill: Skill }) {
  const api = useApi();
  // The list as it is now, since files change while the editor is open.
  const skill = useSkills(workspaceId).data?.find((item) => item.id === initial.id) ?? initial;
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.skills(workspaceId) });

  async function add(files: FileList) {
    setError(undefined);
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_SKILL_FILE_BYTES) {
          setError(`${file.name} is over 100 KB`);
          continue;
        }
        const path = file.name.replace(/[^\w.-]+/g, "-");
        await api.skills.putFile(workspaceId, skill.id, { path, content: await file.text() });
      }
      await refresh();
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "The file couldn't be added");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Files</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="text-accent focus-visible:outline-accent inline-flex items-center gap-1 rounded text-sm font-medium hover:underline focus-visible:outline-2 disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add a file
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".md,.txt,.csv,.json,.html,.xml,.yaml,.yml"
          className="hidden"
          data-testid="skill-file-input"
          onChange={(event) => event.target.files && void add(event.target.files)}
        />
      </div>
      <p className="text-muted text-xs">
        Templates and reference text the agent reads when your instructions mention them, up to 100
        KB each.
      </p>
      {skill.files.length > 0 ? (
        <ul className="divide-line border-line divide-y rounded-lg border" aria-label="Skill files">
          {skill.files.map((file) => (
            <li key={file.path} className="flex items-center gap-2 px-3 py-2 text-sm">
              <FileText className="text-muted size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
              <span className="text-muted text-xs">{formatSize(file.sizeBytes)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.path}`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.skills.removeFile(workspaceId, skill.id, file.path);
                    await refresh();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="text-muted hover:text-danger focus-visible:outline-accent inline-flex size-7 items-center justify-center rounded focus-visible:outline-2"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
