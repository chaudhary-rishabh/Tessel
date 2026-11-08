import { describe, expect, it } from "vitest";
import { sparseVector } from "./sparse";
import { createQdrantIndex } from "./vector-index";

// Runs against a real Qdrant (a container in CI).
const url = process.env.TEST_QDRANT_URL;

describe.skipIf(!url)("Qdrant index (integration)", () => {
  const index = createQdrantIndex({
    url: url!,
    collection: `test_${Date.now().toString(36)}`,
    dimensions: 4,
  });
  const chunk = (
    workspace: string,
    document: string,
    i: number,
    text: string,
    dense: number[],
  ) => ({
    payload: {
      workspace_id: workspace,
      document_id: document,
      chunk_index: i,
      text,
      filename: "f.md",
    },
    dense,
    sparse: sparseVector(text),
  });

  it("searches by meaning and keywords within one workspace", async () => {
    await index.ensureCollection();
    await index.ensureCollection(); // safe to run on every start
    await index.upsert([
      chunk("w1", "d1", 0, "The travel policy covers zephyrine trains", [0, 0, 1, 0]),
      chunk("w1", "d1", 1, "Laptops are replaced every three years", [1, 0, 0, 0]),
      chunk("w2", "d2", 0, "Another workspace mentions zephyrine too", [0, 0, 1, 0]),
    ]);

    const byKeyword = await index.search({
      workspaceId: "w1",
      dense: [1, 0, 0, 0],
      sparse: sparseVector("zephyrine"),
      limit: 5,
    });
    expect(byKeyword.every((hit) => hit.payload.workspace_id === "w1")).toBe(true);
    expect(byKeyword.map((hit) => hit.payload.text)).toContain(
      "The travel policy covers zephyrine trains",
    );

    const byMeaning = await index.search({
      workspaceId: "w1",
      dense: [1, 0, 0, 0],
      sparse: sparseVector("hardware"),
      limit: 1,
    });
    expect(byMeaning[0]!.payload.text).toBe("Laptops are replaced every three years");

    // Re-indexing overwrites by stable ID; deleting removes only that document.
    await index.upsert([chunk("w1", "d1", 0, "Updated travel policy", [0, 0, 1, 0])]);
    await index.deleteDocument("w1", "d1");
    expect(
      await index.search({
        workspaceId: "w1",
        dense: [0, 0, 1, 0],
        sparse: sparseVector("travel"),
        limit: 5,
      }),
    ).toEqual([]);
    expect(
      await index.search({
        workspaceId: "w2",
        dense: [0, 0, 1, 0],
        sparse: sparseVector("zephyrine"),
        limit: 5,
      }),
    ).toHaveLength(1);
  });
});
