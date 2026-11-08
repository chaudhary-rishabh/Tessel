import { describe, expect, it } from "vitest";
import type { GraphExtraction, GraphStore } from "../types";

export const ORG: GraphExtraction = {
  chunkIndex: 0,
  entities: [
    { name: "Alice Chen", type: "Person", description: "Head of payments" },
    { name: "Payments Team", type: "Team", description: "" },
    { name: "Ledger Service", type: "System", description: "" },
    { name: "Bob Ray", type: "Person", description: "" },
  ],
  relations: [
    {
      source: "Alice Chen",
      target: "Payments Team",
      type: "MANAGES",
      description: "Alice leads payments.",
    },
    { source: "Payments Team", target: "Ledger Service", type: "OWNS", description: "" },
    { source: "Bob Ray", target: "Payments Team", type: "MEMBER_OF", description: "" },
    { source: "Ghost", target: "Payments Team", type: "HAUNTS", description: "" },
  ],
};

/** Behaviour every graph store must have; run against memory here and Neo4j in CI. */
export function graphStoreContract(
  name: string,
  makeStore: () => GraphStore | Promise<GraphStore>,
  workspace = "w1",
) {
  describe(name, () => {
    it("stores a document's graph, scoped to its workspace", async () => {
      const store = await makeStore();
      await store.replaceDocument(workspace, { id: `${workspace}-d1`, filename: "org.md" }, [ORG]);
      await store.replaceDocument("other", { id: "other-d1", filename: "x.md" }, [ORG]);

      const hits = await store.findEntities(workspace, ["alice chen", "PAYMENTS"]);
      expect(hits.map((hit) => hit.name)).toEqual(
        expect.arrayContaining(["Alice Chen", "Payments Team"]),
      );

      const [alice] = await store.findEntities(workspace, ["Alice Chen"], 1);
      const facts = await store.neighborhood(workspace, [alice!.key], { depth: 2 });
      expect(facts.map((fact) => `${fact.source}-${fact.type}-${fact.target}`).sort()).toEqual([
        "Alice Chen-MANAGES-Payments Team",
        "Bob Ray-MEMBER_OF-Payments Team",
        "Payments Team-OWNS-Ledger Service",
      ]);
      expect(facts.every((fact) => fact.filename === "org.md")).toBe(true);
      expect(await store.neighborhood(workspace, [alice!.key], { depth: 1 })).toHaveLength(1);
      expect(await store.counts(workspace)).toEqual({ entities: 4, relations: 3 });
    });

    it("replaces and removes a document's contribution", async () => {
      const store = await makeStore();
      await store.replaceDocument(workspace, { id: `${workspace}-d2`, filename: "org.md" }, [ORG]);
      await store.replaceDocument(workspace, { id: `${workspace}-d2`, filename: "org.md" }, [
        { chunkIndex: 3, entities: ORG.entities.slice(0, 2), relations: ORG.relations.slice(0, 1) },
      ]);
      expect(await store.counts(workspace)).toMatchObject({ relations: 1 });
      await store.deleteDocument(workspace, `${workspace}-d2`);
      expect(await store.counts(workspace)).toEqual({ entities: 0, relations: 0 });
      expect(await store.findEntities(workspace, ["Alice Chen"])).toEqual([]);
    });
  });
}
