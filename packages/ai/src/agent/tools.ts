import { z } from "zod";
import type { AiCallContext } from "../usage";

/** What a tool may do. Tools that change data always need the user's approval. */
export type ToolRisk = "read" | "write" | "destructive";

export interface ToolRunContext {
  /** Who the tool acts for: always the signed-in user, never something from the model. */
  context: AiCallContext;
  signal: AbortSignal;
}

export interface ToolOutput {
  /** What the model sees. Treated as data, never as instructions. */
  content: string;
  /** A short line for the interface, e.g. "Found 4 passages". */
  summary: string;
  /** Extra data for the interface or the caller, e.g. citations. Not shown to the model. */
  artifact?: unknown;
}

export interface ToolDefinition<Schema extends z.ZodType = z.ZodType> {
  /** snake_case, as the model calls it. */
  name: string;
  /** Shown to the user, e.g. "Search documents". */
  title: string;
  /** Tells the model when and how to use the tool. */
  description: string;
  schema: Schema;
  risk: ToolRisk;
  /** Shown on the approval card, e.g. "Create travel-notes.md". May look things up. */
  describeCall?: (args: z.infer<Schema>) => string | Promise<string>;
  run(args: z.infer<Schema>, run: ToolRunContext): Promise<ToolOutput>;
}

/** A failure the tool expects and explains, shown to the user and the model as written. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function defineTool<Schema extends z.ZodType>(
  tool: ToolDefinition<Schema>,
): ToolDefinition<Schema> {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(tool.name))
    throw new Error(`Invalid tool name "${tool.name}"`);
  return tool;
}

export const needsApproval = (tool: Pick<ToolDefinition, "risk">) => tool.risk !== "read";

/** The tools an agent may use, looked up by the name the model calls. */
export interface ToolRegistry {
  list(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
  /** OpenAI-format definitions for binding to a chat model. */
  definitions(): {
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  }[];
}

export function createToolRegistry(tools: ToolDefinition[]): ToolRegistry {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`Duplicate tool "${tool.name}"`);
    byName.set(tool.name, tool);
  }
  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
    definitions: () =>
      [...byName.values()].map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description:
            tool.risk === "read"
              ? tool.description
              : `${tool.description} The user is asked to approve this first.`,
          parameters: z.toJSONSchema(tool.schema),
        },
      })),
  };
}
