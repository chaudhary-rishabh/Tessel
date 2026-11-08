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

export const currentTimeTool = defineTool({
  name: "current_time",
  title: "Check the time",
  description:
    "Get the current date and time, optionally in an IANA time zone such as Asia/Kolkata or Europe/London.",
  schema: z.object({ timezone: z.string().max(64).optional() }),
  risk: "read",
  async run({ timezone }) {
    const zone = timezone ?? "UTC";
    let formatted: string;
    try {
      formatted = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        dateStyle: "full",
        timeStyle: "long",
      }).format(new Date());
    } catch {
      throw new Error(`Unknown time zone "${zone}"`);
    }
    return {
      content: `${formatted} (${zone}). ISO: ${new Date().toISOString()}`,
      summary: `${formatted}`,
    };
  },
});
