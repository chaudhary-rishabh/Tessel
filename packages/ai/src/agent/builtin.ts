import { z } from "zod";
import { evaluateExpression } from "./calculator";
import { defineTool } from "./tools";

export const calculatorTool = defineTool({
  name: "calculator",
  title: "Calculate",
  description:
    "Evaluate an arithmetic expression exactly. Use it for any calculation instead of doing arithmetic yourself. Supports + - * / % ^, parentheses, sqrt, abs, round(x, digits), floor, ceil, min, max, log, ln, exp, sin, cos, tan, pi, e.",
  schema: z.object({
    expression: z.string().min(1).max(500).describe("For example: (1250 * 0.18) + 40"),
  }),
  risk: "read",
  async run({ expression }) {
    const result = evaluateExpression(expression);
    const formatted = Number.isInteger(result)
      ? String(result)
      : String(Number(result.toPrecision(12)));
    return { content: `${expression} = ${formatted}`, summary: `${expression} = ${formatted}` };
  },
});

/** The current-time tool, reading the clock from `now` (fixed in evaluations, so recordings stay valid). */
export function createCurrentTimeTool(now: () => Date = () => new Date()) {
  return defineTool({
    name: "current_time",
    title: "Check the time",
    description:
      "Get the current date and time, optionally in an IANA time zone such as Asia/Kolkata or Europe/London.",
    schema: z.object({ timezone: z.string().max(64).optional() }),
    risk: "read",
    async run({ timezone }) {
      const zone = timezone ?? "UTC";
      const date = now();
      let formatted: string;
      try {
        formatted = new Intl.DateTimeFormat("en-GB", {
          timeZone: zone,
          dateStyle: "full",
          timeStyle: "long",
        }).format(date);
      } catch {
        throw new Error(`Unknown time zone "${zone}"`);
      }
      return {
        content: `${formatted} (${zone}). ISO: ${date.toISOString()}`,
        summary: `${formatted}`,
      };
    },
  });
}

export const currentTimeTool = createCurrentTimeTool();
