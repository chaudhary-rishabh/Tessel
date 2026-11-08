import { expect, test } from "@playwright/test";
import { openNavigation, signUp } from "./helpers";

// The end-to-end setup runs a GitHub-like mock MCP server that accepts
// "mock-token", and an OAuth-protected one on port 4401.
test.describe("connectors", () => {
  test("connects GitHub with a token and creates an issue after approval", async ({ page }) => {
    await signUp(page);
    await openNavigation(page);
    await page.getByRole("link", { name: "Connectors" }).click();
    await expect(page.getByRole("heading", { name: "Connectors", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Connect GitHub" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect GitHub" });
    await dialog.getByLabel("Access token").fill("mock-token");
    await dialog.getByRole("button", { name: "Connect" }).click();
    await expect(dialog).toHaveCount(0);

    const connections = page.getByRole("list", { name: "Your connectors" });
    await expect(connections).toContainText("GitHub");
    await expect(connections).toContainText("Connected");
    await connections.getByRole("button", { name: "3 tools" }).click();
    await expect(page.getByLabel("Approval for Search issues")).toHaveValue("auto");
    await expect(page.getByLabel("Approval for Create issue")).toContainText("Default: Ask first");

    await page.goto("/chat");
    await page
      .getByRole("textbox", { name: "Message" })
      .fill(
        `MOCK_TOOLS ${JSON.stringify([{ name: "github_create_issue", args: { title: "Fix login" } }])}`,
      );
    await page.getByRole("button", { name: "Send message" }).click();
    const approval = page.getByRole("region", { name: "Allow Tessel to create issue in GitHub?" });
    await expect(approval).toContainText('GitHub: Create issue with title "Fix login"');
    await approval.getByRole("button", { name: "Allow" }).click();
    await expect(
      page
        .getByRole("list", { name: "Messages" })
        .getByText(/Tool result: Created issue #\d+: Fix login/),
    ).toBeVisible();
  });

  test("connects a custom server by signing in with OAuth", async ({ page }) => {
    await signUp(page);
    await page.goto("/connectors");
    await page.getByRole("button", { name: "Custom server" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a custom connector" });
    await dialog.getByLabel("Name").fill("Tracker");
    await dialog.getByLabel("Server URL").fill("http://127.0.0.1:4401/mcp");
    await expect(dialog.getByLabel("Sign in with OAuth")).toBeChecked();
    await dialog.getByRole("button", { name: "Continue to sign in" }).click();

    // The mock app approves at once and sends the browser back through the API.
    await expect(page).toHaveURL(/\/connectors\?connected=/);
    await expect(page.getByRole("status")).toContainText("Tracker is connected");
    await expect(page.getByRole("list", { name: "Your connectors" })).toContainText("Connected");
  });

  test("explains a token the app rejects", async ({ page }) => {
    await signUp(page);
    await page.goto("/connectors");
    await page.getByRole("button", { name: "Connect GitHub" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect GitHub" });
    await dialog.getByLabel("Access token").fill("wrong-token");
    await dialog.getByRole("button", { name: "Connect" }).click();
    await expect(dialog.getByRole("alert")).toContainText("The server didn't accept that token");
  });
});
