import { randomUUID } from "node:crypto";
import { afterAll, describe } from "vitest";
import { graphStoreContract } from "./testing/contract";
import { createNeo4jGraphStore } from "./neo4j";

// Runs against a real Neo4j when TEST_NEO4J_URL is set (CI starts one).
const url = process.env.TEST_NEO4J_URL;

// A fresh Neo4j is slow to accept its first Bolt connection and schema changes.
describe.skipIf(!url)("Neo4j graph store", { timeout: 60_000 }, () => {
  const store = url
    ? createNeo4jGraphStore({
        url,
        username: process.env.TEST_NEO4J_USERNAME ?? "neo4j",
        password: process.env.TEST_NEO4J_PASSWORD ?? "tessel-local-password",
      })
    : undefined;
  afterAll(() => store?.close());
  if (store) {
    graphStoreContract(
      "neo4j",
      async () => {
        await store.ensureSchema();
        return store;
      },
      () => `ws-${randomUUID()}`,
    );
  }
});
