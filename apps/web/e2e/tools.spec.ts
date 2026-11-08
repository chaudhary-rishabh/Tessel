import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

const messages = (page: Page) => page.getByRole("list", { name: "Messages" });
const steps = (page: Page) => messages(page).getByRole("list", { name: "Steps" });
const tools = (...calls: { name: string; args: Record<string, unknown> }[]) =>
  `MOCK_TOOLS ${JSON.stringify(calls)}`;

async function sendMessage(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.describe("tools", () => {
  test("shows a step the assistant ran and what it found", async ({ page }) => {
    await signUp(page);
    await sendMessage(page, tools({ name: "calculator", args: { expression: "6 * 7" } }));

    await expect(messages(page).getByText("Tool result: 6 * 7 = 42")).toBeVisible();
    const step = steps(page).getByRole("button", { name: /Calculate/ });
    await expect(step).toContainText("6 * 7");
    await step.click();
    await expect(steps(page).getByText("expression")).toBeVisible();
  });

  test("asks before creating a document and creates it once allowed", async ({ page }) => {
    await signUp(page);
    await sendMessage(
      page,
      tools({
        name: "create_document",
        args: { filename: "launch-notes.md", content: "# Launch" },
      }),
    );

    const approval = page.getByRole("region", { name: "Allow Tessel to create a document?" });
    await expect(approval).toBeVisible();
    await expect(approval).toContainText(
      'Create "launch-notes.md" in the workspace (8 characters)',
    );

    // The question survives a reload: nothing happens until the user decides.
    await page.reload();
    await approval.getByRole("button", { name: "Show details" }).click();
    await expect(approval.getByText("# Launch")).toBeVisible();
    await approval.getByRole("button", { name: "Allow" }).click();

    await expect(messages(page).getByText(/Tool result: Created launch-notes\.md/)).toBeVisible();
    await expect(approval).toHaveCount(0);
    await expect(steps(page).getByRole("button", { name: /Create a document/ })).toContainText(
      "Created launch-notes.md",
    );

    await page.goto("/documents");
    await expect(
      page.getByRole("list", { name: "Documents" }).getByText("launch-notes.md"),
    ).toBeVisible();
  });

  test("tells the assistant when the user declines", async ({ page }) => {
    await signUp(page);
    await sendMessage(
      page,
      tools({ name: "create_document", args: { filename: "draft.md", content: "Draft" } }),
    );
    const approval = page.getByRole("region", { name: "Allow Tessel to create a document?" });
    await approval.getByRole("button", { name: "Decline" }).click();

    await expect(messages(page).getByText(/The user declined this action/)).toBeVisible();
    await expect(steps(page).getByRole("button", { name: /Create a document/ })).toContainText(
      "Declined",
    );
  });

  test("cancels the pending action when the user sends another message", async ({ page }) => {
    await signUp(page);
    await sendMessage(
      page,
      tools({ name: "create_document", args: { filename: "later.md", content: "Later" } }),
    );
    const approval = page.getByRole("region", { name: "Allow Tessel to create a document?" });
    await expect(approval).toBeVisible();

    await sendMessage(page, "Never mind");
    await expect(messages(page).getByText("Echo: Never mind")).toBeVisible();
    await expect(approval).toHaveCount(0);
    await page.reload();
    await expect(steps(page).getByRole("button", { name: /Create a document/ })).toContainText(
      "Cancelled",
    );
  });
});
