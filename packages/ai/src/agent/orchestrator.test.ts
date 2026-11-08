import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLogger } from "@tessel/logger";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAi } from "../ai";
import { loadModelRegistry } from "../registry";
import { createSpendGuard, memorySpendStore } from "../spend";
import { memoryLedger, startMockGateway, type MockGateway } from "../testing";
import { calculatorTool, currentTimeTool } from "./builtin";
import {
  resumeOrchestrator,
  runOrchestrator,
  toOrchestratorCheckpoint,
  type ActivityItem,
  type AgentMode,
  type OrchestratorEvent,
  type OrchestratorOptions,
} from "./orchestrator";
import { runAgent, type AgentOptions } from "./react";
import { createToolRegistry, defineTool } from "./tools";

const logger = createLogger("orchestrator-test", { level: "silent", pretty: false });
const context = { workspaceId: "w1", userId: "u1", feature: "chat" as const };

let gateway: MockGateway;
beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(() => gateway.close());
beforeEach(() => gateway.reset());

const notes: string[] = [];
const saveNote = defineTool({
  name: "save_note",
  title: "Save a note",
  description: "Save a note",
  schema: z.object({ text: z.string().min(1) }),
  risk: "write",
  run: async ({ text }) => {
    notes.push(text);
    return { content: `Saved "${text}"`, summary: "Saved" };
  },
});

function setup() {
  const ai = createAi({
    gateway: { apiKey: "k", baseURL: gateway.url },
    registry: loadModelRegistry(),
    spend: createSpendGuard({
      store: memorySpendStore(),
      limits: { userDailyUsd: 100, workspaceDailyUsd: 100, globalDailyUsd: 100 },
      logger,
    }),
    ledger: memoryLedger(),
    moderation: { mode: "off", failure: "allow" },
    logger,
    timeoutMs: 5_000,
  });
  const events: OrchestratorEvent[] = [];
  const options: OrchestratorOptions = {
    model: ai.chatModel(context),
    thinker: ai.chatModel({ ...context, feature: "agent" }),
    critic: ai.chatModel({ ...context, feature: "agent" }, ai.registry.forRole("utility").id),
    tools: createToolRegistry([calculatorTool, currentTimeTool, saveNote]),
    workers: [
      {
        name: "analyst",
        title: "Analyst",
        description: "Calculates",
        tools: ["calculator", "current_time"],
      },
      { name: "scribe", title: "Scribe", description: "Saves notes", tools: ["save_note"] },
      { name: "ghost", title: "Ghost", description: "Has no tools here", tools: ["teleport"] },
    ],
    context,
    emit: (event) => events.push(event),
    signal: new AbortController().signal,
    logger,
  };
  return { options, events };
}

const conversation = (text: string) => [
  new SystemMessage("You are a test agent."),
  new HumanMessage(text),
];
const lastActivity = (events: OrchestratorEvent[]): ActivityItem[] =>
  events.findLast((event) => event.type === "activity")?.items ?? [];
const answerText = (events: OrchestratorEvent[]) =>
  events.flatMap((event) => (event.type === "token" ? [event.text] : [])).join("");
const forcedTools = () =>
  gateway.requests
    .map(
      (request) =>
        (request.body.tool_choice as { function?: { name?: string } } | undefined)?.function?.name,
    )
    .filter(Boolean);

describe("orchestrator", () => {
  it("auto mode is the plain ReAct agent", async () => {
    const { options, events } = setup();
    const result = await runOrchestrator(
      options,
      "auto",
      conversation('MOCK_TOOLS [{"name":"calculator","args":{"expression":"2+2"}}]'),
    );
    expect(result).toMatchObject({ status: "complete", text: "Tool result: 2+2 = 4" });
    expect(answerText(events)).toBe("Tool result: 2+2 = 4");
    expect(forcedTools()).toEqual([]);
  });

  it("plans, carries out each step, checks progress, and answers from the results", async () => {
    const { options, events } = setup();
    const result = await runOrchestrator(
      options,
      "plan",
      conversation('MOCK_TOOLS [{"name":"calculator","args":{"expression":"6*7"}}]'),
    );

    expect(result.status).toBe("complete");
    expect(forcedTools()).toEqual(["make_plan", "review_progress"]);
    expect(lastActivity(events).map((item) => [item.title, item.status])).toEqual([
      ["Gather the facts", "done"],
      ["Work out the answer", "done"],
    ]);
    expect(lastActivity(events)[0]!.detail).toBe("Tool result: 6*7 = 42");
    // Step work isn't streamed as the answer; only the final answer is.
    expect(answerText(events)).toBe("Answer from 2 results.");
    expect(result.text).toBe("Answer from 2 results.");
    expect(result.toolCalls).toHaveLength(2);
  });

  it("finishes a plan early or rewrites the rest when progress says so", async () => {
    const early = setup();
    await runOrchestrator(early.options, "plan", conversation("MOCK_FINISH_EARLY please"));
    expect(lastActivity(early.events).map((item) => item.status)).toEqual(["done", "skipped"]);
    expect(answerText(early.events)).toBe("Answer from 1 results.");

    gateway.reset();
    const revised = setup();
    await runOrchestrator(revised.options, "plan", conversation("MOCK_REVISE please"));
    expect(lastActivity(revised.events).map((item) => [item.title, item.status])).toEqual([
      ["Gather the facts", "done"],
      ["Work out the answer", "skipped"],
      ["Double-check", "done"],
    ]);
  });

  it("pauses a plan step for approval and resumes from the saved checkpoint", async () => {
    const { options, events } = setup();
    notes.length = 0;
    const request = conversation(
      'MOCK_ONE_STEP MOCK_TOOLS [{"name":"save_note","args":{"text":"ship it"}}]',
    );
    const paused = await runOrchestrator(options, "plan", request);
    expect(paused.status).toBe("waiting");
    expect(paused.toolCalls[0]).toMatchObject({ name: "save_note", status: "waiting" });
    expect(lastActivity(events)[0]!.status).toBe("running");

    // The checkpoint survives a round trip through JSON, as it does through Postgres.
    const saved = toOrchestratorCheckpoint(JSON.parse(JSON.stringify(paused.checkpoint)));
    const resumed = await resumeOrchestrator(options, saved, {
      callId: paused.pendingCallId!,
      approved: true,
    });
    expect(notes).toEqual(["ship it"]);
    expect(resumed.status).toBe("complete");
    expect(resumed.activity[0]).toMatchObject({
      status: "done",
      detail: 'Tool result: Saved "ship it"',
    });
    expect(resumed.text).toBe("Answer from 1 results.");
    expect(resumed.toolCalls[0]!.status).toBe("completed");

    await expect(
      resumeOrchestrator(options, saved, { callId: "other", approved: true }),
    ).rejects.toMatchObject({ code: "approval_not_pending" });
  });

  it("publishes a draft the reviewer is happy with", async () => {
    const { options, events } = setup();
    const result = await runOrchestrator(options, "reflect", conversation("Explain caching"));
    expect(forcedTools()).toEqual(["review_draft"]);
    expect(result.text).toBe("Echo: Explain caching");
    expect(lastActivity(events).map((item) => [item.title, item.status, item.detail])).toEqual([
      ["Write a draft", "done", undefined],
      ["Review the draft", "done", "Nothing important to fix"],
    ]);
  });

  it("rewrites a draft that the reviewer found issues with", async () => {
    const { options, events } = setup();
    const result = await runOrchestrator(options, "reflect", conversation("MOCK_CRITIQUE caching"));
    expect(result.text).toBe("Revised answer with a one-line summary.");
    expect(answerText(events)).toBe("Revised answer with a one-line summary.");
    expect(lastActivity(events).map((item) => item.title)).toEqual([
      "Write a draft",
      "Review the draft",
      "Fix the issues",
    ]);
    expect(lastActivity(events)[1]!.detail).toBe("• Add a one-line summary");
  });

  it("hands work to specialists with their own tools, then writes from their reports", async () => {
    const { options, events } = setup();
    const result = await runOrchestrator(
      options,
      "team",
      conversation(
        'MOCK_TWO_WORKERS MOCK_TOOLS [{"name":"calculator","args":{"expression":"1+1"}}]',
      ),
    );
    expect(lastActivity(events).map((item) => [item.title, item.status])).toEqual([
      ["Analyst: Task for analyst", "done"],
      ["Scribe: Task for scribe", "done"],
    ]);
    // Workers only see their own tools; a worker without any isn't on the team.
    const workerRequests = gateway.requests.filter(
      (request) => request.body.stream === true && Array.isArray(request.body.tools),
    );
    const offered = workerRequests.map((request) =>
      (request.body.tools as { function: { name: string } }[]).map((tool) => tool.function.name),
    );
    expect(offered[0]).toEqual(["calculator", "current_time"]);
    expect(offered.some((names) => names.includes("save_note"))).toBe(true);
    const delegate = gateway.requests.find(
      (request) =>
        (request.body.tool_choice as { function?: { name?: string } } | undefined)?.function
          ?.name === "delegate",
    )!;
    expect(JSON.stringify(delegate.body)).not.toContain("ghost");
    // The analyst calculated; the scribe was asked for a calculator it doesn't have.
    expect(result.toolCalls.map((call) => [call.name, call.status])).toEqual([
      ["calculator", "completed"],
      ["calculator", "failed"],
    ]);
    expect(result.text).toBe("Answer from 2 reports.");
  });

  it.each<AgentMode>(["plan", "reflect", "team"])(
    "keeps going when %s helper calls return nonsense",
    async (mode) => {
      const { options } = setup();
      gateway.enqueue({ toolCall: { name: "nonsense", args: { wrong: true } } });
      const result = await runOrchestrator(options, mode, conversation("Hello there"));
      expect(result.status).toBe("complete");
      expect(result.text.length).toBeGreaterThan(0);
    },
  );
});

describe("parallel tool calls", () => {
  it("runs neighbouring read-only calls together and keeps their order", async () => {
    const started: string[] = [];
    let running = 0;
    let most = 0;
    const lookup = defineTool({
      name: "lookup",
      title: "Look up",
      description: "Looks something up",
      schema: z.object({ key: z.string(), wait: z.number() }),
      risk: "read",
      run: async ({ key, wait }) => {
        started.push(key);
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, wait));
        running -= 1;
        return { content: key, summary: key };
      },
    });
    const { options } = setup();
    const agentOptions: AgentOptions = {
      ...options,
      tools: createToolRegistry([lookup]),
      emit: () => undefined,
    };
    const result = await runAgent(
      agentOptions,
      conversation(
        `MOCK_TOOLS ${JSON.stringify([
          { name: "lookup", args: { key: "slow", wait: 80 } },
          { name: "lookup", args: { key: "fast", wait: 5 } },
        ])}`,
      ),
    );
    expect(most).toBe(2);
    expect(started).toEqual(["slow", "fast"]);
    const toolMessages = result.messages.filter((message) => message.type === "tool");
    expect(toolMessages.map((message) => String(message.data.content))).toEqual([
      expect.stringContaining("slow"),
      expect.stringContaining("fast"),
    ]);
  });
});
