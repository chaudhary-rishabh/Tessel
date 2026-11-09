import { defineTool, ToolError, type ToolDefinition, type ToolRisk } from "@tessel/ai";
import { z } from "zod";
import type { ConnectorClient, RemoteTool } from "./client";

/** What the user chose for one tool: follow the server's hint, always ask, never ask, or hide it. */
export type ToolPolicy = "auto" | "ask" | "allow" | "off";

/**
 * Whether a tool needs approval. Servers' hints are only hints: a tool runs
 * without asking only when the server marks it read-only or the user
 * allowed it.
 */
export function toolRisk(tool: RemoteTool, policy: ToolPolicy = "auto"): ToolRisk | null {
  if (policy === "off") return null;
  if (policy === "allow") return "read";
  if (policy === "ask") return tool.annotations?.destructiveHint ? "destructive" : "write";
  if (tool.annotations?.readOnlyHint) return "read";
  return tool.annotations?.destructiveHint === false ? "write" : "destructive";
}

/** A model-safe tool name: lower-case letters, digits, and underscores, at most 64 characters. */
export function toolName(prefix: string, name: string): string {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const head = clean(prefix).replace(/^[^a-z]+/, "") || "app";
  return `${head}_${clean(name)}`.slice(0, 64).replace(/_+$/, "");
}

export function toolTitle(tool: RemoteTool): string {
  const raw = tool.annotations?.title ?? tool.title ?? tool.name;
  const spaced = raw.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const MAX_DESCRIPTION = 1_000;

/** Keeps only what a model's tool parameters accept: an object schema. */
function parametersFor(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object") return schema;
  return { type: "object", properties: {} };
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(
      ([, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    )
    .slice(0, 2)
    .map(([key, value]) => {
      const text = String(value).replace(/\s+/g, " ");
      return `${key.replace(/_/g, " ")} "${text.length > 60 ? `${text.slice(0, 59)}…` : text}"`;
    });
  return parts.join(", ");
}

export interface ConnectorToolSource {
  /** Shown to the user and the model, e.g. "GitHub". */
  name: string;
  /** Prefix for tool names, e.g. "github". */
  prefix: string;
  tools: RemoteTool[];
  policies: Record<string, ToolPolicy>;
  /** Opens (or reuses) a client for this connection. */
  client: () => Promise<ConnectorClient>;
}

/**
 * Turns a connection's MCP tools into agent tools. Calls go to the remote
 * server through the shared client; results come back as data.
 */
export function connectorTools(
  source: ConnectorToolSource,
  taken = new Set<string>(),
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const remote of source.tools) {
    const risk = toolRisk(remote, source.policies[remote.name] ?? "auto");
    if (!risk) continue;
    // On a clash, try base_2, base_3, ... (not base_2_3).
    const base = toolName(source.prefix, remote.name);
    let name = base;
    for (let n = 2; taken.has(name); n += 1) name = `${base.slice(0, 60)}_${n}`;
    taken.add(name);
    const title = toolTitle(remote);
    tools.push(
      defineTool({
        name,
        title: `${source.name}: ${title}`,
        description: `[${source.name}] ${(remote.description ?? title).slice(0, MAX_DESCRIPTION)}`,
        schema: z.record(z.string(), z.unknown()),
        parameters: parametersFor(remote.inputSchema),
        risk,
        describeCall: (args) => {
          const detail = summarizeArgs(args);
          return `${source.name}: ${title}${detail ? ` with ${detail}` : ""}`;
        },
        async run(args, { signal }) {
          const client = await source.client();
          const output = await client.callTool(remote.name, args, signal);
          if (output.isError)
            throw new ToolError(output.text || `${source.name} reported an error`);
          return {
            content: output.text || "(no output)",
            summary: output.text.split("\n")[0]!.slice(0, 120) || "Done",
          };
        },
      }),
    );
  }
  return tools;
}
