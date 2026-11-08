import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLogger } from "@tessel/logger";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAi } from "../ai";
import { loadModelRegistry } from "../registry";
import { createSpendGuard, memorySpendStore } from "../spend";
import { memoryLedger, startMockGateway, type MockGateway } from "../testing";
import { calculatorTool, currentTimeTool } from "./builtin";
import { evaluateExpression } from "./calculator";
import { resumeAgent, runAgent, type AgentEvent, type AgentOptions } from "./react";
import { createToolRegistry, defineTool } from "./tools";

const logger = createLogger("agent-test", { level: "silent", pretty: false });
const context = { workspaceId: "w1", userId: "u1", feature: "chat" as const };

let gateway: MockGateway;
beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(() => gateway.close());
beforeEach(() => gateway.reset());

const saved: string[] = [];
const saveNote = defineTool({
  name: "save_note",
  title: "Save a note",
  description: "Save a note",
  schema: z.object({ text: z.string().min(1) }),
  risk: "write",
  describeCall: ({ text }) => `Save "${text}"`,
  async run({ text }) {
    saved.push(text);
    return { content: `Saved "${text}"`, summary: "Saved" };
  },
});
const slow = defineTool({
  name: "slow",
  title: "Slow",
  description: "Takes forever",
  schema: z.object({}),
  risk: "read",
  run: () => new Promise(() => undefined),
});
const broken = defineTool({
  name: "broken",
  title: "Broken",
  description: "Always fails",
  schema: z.object({}),
  risk: "read",
  run: () => Promise.reject(new Error("Service unavailable")),
});

function setup(overrides: Partial<AgentOptions> = {}) {
  const ledger = memoryLedger();
  const ai = createAi({
    gateway: { apiKey: "k", baseURL: gateway.url },
    registry: loadModelRegistry(),
    spend: createSpendGuard({
      store: memorySpendStore(),
      limits: { userDailyUsd: 100, workspaceDailyUsd: 100, globalDailyUsd: 100 },
      logger,
    }),
    ledger,
    moderation: { mode: "off", failure: "allow" },
    logger,
    timeoutMs: 5_000,
  });
  const events: AgentEvent[] = [];
  const options: AgentOptions = {
    model: ai.chatModel(context),
    tools: createToolRegistry([calculatorTool, currentTimeTool, saveNote, slow, broken]),
    context,
    emit: (event) => events.push(event),
    signal: new AbortController().signal,
    logger,
    toolTimeoutMs: 200,
    ...overrides,
  };
  return { options, events, ledger };
}

const ask = (calls: unknown[]) => [
  new SystemMessage("You are a test agent."),
  new HumanMessage(`MOCK_TOOLS ${JSON.stringify(calls)}`),
];
const tools = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.type === "tool" ? [[event.call.name, event.call.status]] : []));

describe("ReAct agent", () => {
  it("calls a tool, reads the result, and answers", async () => {
    const { options, events, ledger } = setup();
    const result = await runAgent(
      options,
      ask([{ name: "calculator", args: { expression: "2 * 21" } }]),
    );

    expect(result.status).toBe("complete");
    expect(result.text).toBe("Tool result: 2 * 21 = 42");
    expect(tools(events)).toEqual([
      ["calculator", "running"],
      ["calculator", "completed"],
    ]);
    expect(result.toolCalls[0]).toMatchObject({
      title: "Calculate",
      summary: "2 * 21 = 42",
      requiresApproval: false,
    });
    // The tool definitions went to the model.
    const first = gateway.requests.find((request) => request.path.endsWith("/chat/completions"))!;
    expect(
      (first.body.tools as { function: { name: string } }[]).map((tool) => tool.function.name),
    ).toContain("calculator");
    // Two model calls, both recorded.
    expect(ledger.events.filter((event) => event.feature === "chat")).toHaveLength(2);
  });

  it("pauses before a tool that changes data, and runs it once approved", async () => {
    saved.length = 0;
    const { options, events } = setup();
    const waiting = await runAgent(
      options,
      ask([{ name: "save_note", args: { text: "Ship it" } }]),
    );

    expect(waiting.status).toBe("waiting");
    expect(saved).toEqual([]);
    const call = waiting.toolCalls[0]!;
    expect(call).toMatchObject({
      status: "waiting",
      requiresApproval: true,
      description: 'Save "Ship it"',
    });
    expect(waiting.pendingCallId).toBe(call.id);

    // The checkpoint survives a round trip through JSON, like the database.
    const checkpoint = JSON.parse(JSON.stringify(waiting));
    const done = await resumeAgent(options, checkpoint, { callId: call.id, approved: true });
    expect(saved).toEqual(["Ship it"]);
    expect(done.status).toBe("complete");
    expect(done.text).toBe('Tool result: Saved "Ship it"');
    expect(tools(events).at(-1)).toEqual(["save_note", "completed"]);
  });

  it("tells the model when the user declines", async () => {
    saved.length = 0;
    const { options } = setup();
    const waiting = await runAgent(options, ask([{ name: "save_note", args: { text: "Nope" } }]));
    const done = await resumeAgent(options, waiting, {
      callId: waiting.pendingCallId!,
      approved: false,
    });
    expect(saved).toEqual([]);
    expect(done.toolCalls[0]!.status).toBe("rejected");
    expect(done.text).toContain("The user declined this action");
  });

  it("runs calls in order, pausing at each one that needs approval", async () => {
    saved.length = 0;
    const { options } = setup();
    const calls = [
      { name: "calculator", args: { expression: "1 + 1" } },
      { name: "save_note", args: { text: "first" } },
      { name: "save_note", args: { text: "second" } },
    ];
    const one = await runAgent(options, ask(calls));
    expect(one.toolCalls.map((call) => call.status)).toEqual(["completed", "waiting"]);

    const two = await resumeAgent(options, one, { callId: one.pendingCallId!, approved: true });
    expect(two.status).toBe("waiting");
    expect(two.toolCalls.map((call) => call.status)).toEqual(["completed", "completed", "waiting"]);

    const three = await resumeAgent(options, two, { callId: two.pendingCallId!, approved: true });
    expect(three.status).toBe("complete");
    expect(saved).toEqual(["first", "second"]);

    await expect(
      resumeAgent(options, three, { callId: "anything", approved: true }),
    ).rejects.toMatchObject({
      code: "approval_not_pending",
    });
  });

  it("reports bad arguments, unknown tools, failures, and timeouts to the model instead of crashing", async () => {
    const { options } = setup();
    const result = await runAgent(
      options,
      ask([
        { name: "calculator", args: { expression: 7 } },
        { name: "teleport", args: {} },
        { name: "broken", args: {} },
        { name: "slow", args: {} },
      ]),
    );
    expect(result.status).toBe("complete");
    expect(result.toolCalls.map((call) => [call.name, call.status, call.error])).toEqual([
      ["calculator", "failed", "Invalid arguments"],
      ["teleport", "failed", "Unknown tool"],
      ["broken", "failed", "The tool failed unexpectedly"],
      ["slow", "failed", "The tool took too long"],
    ]);
  });

  it("answers without tools on the last step", async () => {
    const { options } = setup({ maxSteps: 1 });
    const result = await runAgent(
      options,
      ask([{ name: "calculator", args: { expression: "1" } }]),
    );
    expect(result.status).toBe("complete");
    expect(result.toolCalls).toEqual([]);
    expect(result.text).toContain("Echo:");
  });
});

describe("calculator", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["2 ^ 3 ^ 2", 512],
    ["-2 ^ 2", -4],
    ["10 % 4", 2],
    ["sqrt(16) + round(2.345, 2)", 6.35],
    ["max(1, 5, 3) * pi", 5 * Math.PI],
    ["1,250 × 0.18", 225],
    ["1e3 / 4", 250],
  ])("%s = %s", (expression, expected) => {
    expect(evaluateExpression(expression)).toBeCloseTo(expected as number, 10);
  });

  it.each([["1 / 0"], ["2 +"], ["process.exit()"], ["alert(1)"], ["(1"], ["1 2"]])(
    "rejects %s",
    (expression) => {
      expect(() => evaluateExpression(expression)).toThrow();
    },
  );
});
