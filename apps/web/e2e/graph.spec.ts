import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Needs the full stack: S3 and SQS for the upload, the worker to index the
// document and build the graph, and Neo4j (all started in CI).
test.describe("knowledge graph", () => {
  test("maps connections in a document and answers a relationship question from them", async ({
    page,
  }) => {
    await signUp(page);
    await page.goto("/documents");
    const text = [
      "# Org chart",
      // The passage itself is ranked out, so the answer's only source is the graph.
      "MOCK_IRRELEVANT",
      "MOCK_REL: Alice Chen (Person) | MANAGES | Payments Team (Team)",
      "MOCK_REL: Payments Team (Team) | OWNS | Ledger Service (System)",
    ].join("\n");
    await page.getByTestId("document-input").setInputFiles({
      name: "org-chart.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(text),
    });
    const list = page.getByRole("list", { name: "Documents" });
    await expect(list.getByText(/Ready, \d+ passages?/)).toBeVisible({ timeout: 30_000 });

    // The graph is built right after indexing; reload until it shows.
    const graph = page.getByRole("region", { name: "Connections" });
    await expect(async () => {
      await page.reload();
      await expect(graph).toContainText("3 people, teams, and other things", { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await graph.getByLabel("Find connections").fill("Alice Chen");
    await graph.getByRole("button", { name: "Find connections" }).click();
    // A diagram of the neighbourhood first; choosing a neighbour moves to it.
    const diagram = graph.getByRole("group", { name: /^How Alice Chen connects to/ });
    await expect(diagram).toContainText("manages");
    await diagram.getByRole("button", { name: /^Payments Team, team/ }).click();
    await expect(
      graph.getByRole("group", { name: /^How Payments Team connects to/ }),
    ).toBeVisible();
    await graph.getByLabel("Find connections").fill("Alice Chen");
    await graph.getByRole("button", { name: "Find connections" }).click();
    await graph.getByRole("tab", { name: "list" }).click();
    const connections = graph.getByRole("list", { name: "Connections" });
    await expect(connections).toContainText("manages");
    await expect(connections).toContainText("Ledger Service");

    await page.goto("/chat");
    await page.getByRole("textbox", { name: "Message" }).fill('Who does "Alice Chen" manage?');
    await page.getByRole("button", { name: "Send message" }).click();
    const messages = page.getByRole("list", { name: "Messages" });
    const chip = messages.getByRole("button", { name: /Source 1/ });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.getByRole("dialog")).toContainText(
      "Alice Chen (Person) manages Payments Team (Team)",
    );
  });
});
