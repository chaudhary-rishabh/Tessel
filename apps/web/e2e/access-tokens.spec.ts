import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

const MCP_URL = "http://localhost:4100/mcp";

async function connectClient(token: string) {
  const client = new Client({ name: "e2e-client", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

test.describe("access tokens and the MCP server", () => {
  test("an outside MCP client uses a token from Settings until it's revoked", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings");
    const section = page.getByRole("region", { name: "Access tokens" });
    await expect(section).toContainText(MCP_URL);
    await section.getByRole("button", { name: "New token" }).click();

    const dialog = page.getByRole("dialog", { name: "New access token" });
    await dialog.getByLabel("Name").fill("Claude Desktop");
    await dialog.getByLabel("Expires after").selectOption("30");
    await expect(dialog.getByLabel("Search and read the workspace's documents")).toBeChecked();
    await dialog.getByLabel("Add notes and text documents to the workspace").check();
    await dialog.getByRole("button", { name: "Create token" }).click();

    const shown = page.getByRole("dialog", { name: "Copy your token" });
    const token = (await shown.getByTestId("new-token").textContent())!.trim();
    expect(token).toMatch(/^tsl_pat_/);
    await expect(shown).toContainText('"Authorization": "Bearer tsl_pat_');
    await shown.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("list", { name: "Access tokens" })).toContainText("Claude Desktop");
    await expect(page.getByRole("list", { name: "Access tokens" })).toContainText(
      "Can read documents and add documents.",
    );

    const client = await connectClient(token);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "search_documents",
      "list_documents",
      "read_document",
      "add_document",
    ]);
    const listed = await client.callTool({ name: "list_documents", arguments: {} });
    expect(listed.content).toEqual([{ type: "text", text: "The workspace has no documents." }]);
    await client.close();

    await page.reload();
    await expect(page.getByRole("list", { name: "Access tokens" })).toContainText("Last used");
    await page.getByRole("button", { name: "Revoke Claude Desktop" }).click();
    await page.getByRole("button", { name: "Revoke token" }).click();
    await expect(page.getByText("No tokens yet.")).toBeVisible();
    await expect(connectClient(token)).rejects.toThrow();
  });
});
