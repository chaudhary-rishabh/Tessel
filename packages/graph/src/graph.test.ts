import { createAi, createSpendGuard, loadModelRegistry, memorySpendStore } from "@tessel/ai";
import { memoryLedger, startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { createLogger } from "@tessel/logger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractGraph, graphWindows } from "./extract";
import { factLine, factsToSources } from "./facts";
import { memoryGraphStore } from "./memory";
import { graphStoreContract } from "./testing/contract";
import { entityKey, relationType } from "./types";

const logger = createLogger("graph-test", { level: "silent", pretty: false });

graphStoreContract("memory graph store", () => memoryGraphStore());

describe("graph helpers", () => {
  it("normalizes entity names and relationship types", () => {
    expect(entityKey("The  Payments-Team!")).toBe("payments team");
    expect(entityKey("Café Ops")).toBe("cafe ops");
    expect(relationType("reports to")).toBe("REPORTS_TO");
    expect(relationType("!!")).toBe("RELATED_TO");
  });

  it("groups chunks into windows that remember where they started", () => {
    const chunks = Array.from({ length: 5 }, (_, index) => ({ index, text: "x".repeat(2_500) }));
    expect(graphWindows(chunks, { size: 6_000 }).map((window) => window.chunkIndex)).toEqual([
      0, 2, 4,
    ]);
    expect(graphWindows(chunks, { size: 6_000, max: 2 })).toHaveLength(2);
  });

  it("turns facts into one citable source per document", () => {
    const fact = {
      source: "Alice Chen",
      sourceType: "Person",
      type: "MANAGES",
      target: "Payments Team",
      targetType: "Team",
      description: "Alice leads payments.",
      documentId: "d1",
      filename: "org.md",
      chunkIndex: 2,
    };
    expect(factLine(fact)).toBe(
      "Alice Chen (Person) manages Payments Team (Team): Alice leads payments.",
    );
    const sources = factsToSources(
      [fact, { ...fact, target: "Ledger", documentId: "d2", filename: "sys.md" }],
      4,
    );
    expect(sources.map((source) => [source.id, source.filename])).toEqual([
      [4, "org.md"],
      [5, "sys.md"],
    ]);
    expect(sources[0]!.text).toContain("- Alice Chen (Person) manages Payments Team (Team)");
  });
});

describe("graph extraction", () => {
  let gateway: MockGateway;
  beforeAll(async () => {
    gateway = await startMockGateway();
  });
  afterAll(() => gateway.close());

  it("extracts entities and relationships with the model", async () => {
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
    });
    const model = ai.chatModel({ workspaceId: "w", userId: "u", feature: "graph" });
    const extraction = await extractGraph(
      model,
      "Org chart.\nMOCK_REL: Alice Chen (Person) | MANAGES | Payments Team (Team)",
      7,
    );
    expect(extraction).toEqual({
      chunkIndex: 7,
      entities: [
        { name: "Alice Chen", type: "Person", description: "" },
        { name: "Payments Team", type: "Team", description: "" },
      ],
      relations: [
        {
          source: "Alice Chen",
          target: "Payments Team",
          type: "MANAGES",
          description: "Alice Chen manages Payments Team.",
        },
      ],
    });
  });
});
