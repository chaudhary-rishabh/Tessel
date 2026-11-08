import { describe, expect, it } from "vitest";
import { chunkSections, cleanText, CHUNK_SIZE } from "./chunking";
import { sparseVector, tokenize } from "./sparse";
import { chunkPointId, memoryVectorIndex } from "./vector-index";

describe("chunking", () => {
  it("keeps chunks within a page and numbers them across the document", async () => {
    const page = (n: number) => `Page ${n} paragraph. `.repeat(200);
    const chunks = await chunkSections([
      { text: page(1), page: 1 },
      { text: page(2), page: 2 },
    ]);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.every((chunk) => chunk.text.length <= CHUNK_SIZE)).toBe(true);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, i) => i));
    expect(
      chunks.filter((chunk) => chunk.page === 1).every((chunk) => chunk.text.includes("Page 1")),
    ).toBe(true);
    expect(chunks.at(-1)?.page).toBe(2);
  });

  it("cleans whitespace without merging paragraphs", () => {
    expect(cleanText("a\r\n\r\n\r\n\tb  \nc")).toBe("a\n\nb\nc");
  });

  it("skips empty sections", async () => {
    expect(await chunkSections([{ text: "   \n " }])).toEqual([]);
  });
});

describe("sparse vectors", () => {
  it("tokenises words in any script and drops stop words", () => {
    expect(tokenize("The Q3 roadmap's launch-plan, für Ümlaut! नमस्ते")).toEqual([
      "q3",
      "roadmap's",
      "launch-plan",
      "für",
      "ümlaut",
      "नमस्ते",
    ]);
  });

  it("maps the same term to the same index and saturates repeats", () => {
    const one = sparseVector("invoice");
    const three = sparseVector("invoice invoice invoice");
    expect(three.indices).toEqual(one.indices);
    expect(three.values[0]).toBeGreaterThan(one.values[0]!);
    expect(three.values[0]).toBeLessThan(one.values[0]! * 3);
    expect(sparseVector("the of and").indices).toEqual([]);
  });
});

describe("vector index", () => {
  it("gives each chunk a stable UUID", () => {
    expect(chunkPointId("doc", 3)).toBe(chunkPointId("doc", 3));
    expect(chunkPointId("doc", 3)).not.toBe(chunkPointId("doc", 4));
    expect(chunkPointId("doc", 3)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("never returns another workspace's chunks", async () => {
    const index = memoryVectorIndex();
    const chunk = (workspace_id: string, text: string) => ({
      payload: {
        workspace_id,
        document_id: `${workspace_id}-doc`,
        chunk_index: 0,
        text,
        filename: "a.txt",
      },
      dense: [1, 0],
      sparse: sparseVector(text),
    });
    await index.upsert([chunk("w1", "quarterly revenue"), chunk("w2", "quarterly revenue")]);
    const hits = await index.search({
      workspaceId: "w1",
      dense: [1, 0],
      sparse: sparseVector("revenue"),
      limit: 10,
    });
    expect(hits.map((hit) => hit.payload.workspace_id)).toEqual(["w1"]);
  });
});
