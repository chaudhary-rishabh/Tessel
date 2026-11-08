import { expect, test } from "@playwright/test";
import { openNavigation, signUp } from "./helpers";

test.describe("documents", () => {
  test("uploads a file, indexes it, and finds it by keyword", async ({ page }) => {
    await signUp(page);
    await openNavigation(page);
    await page.getByRole("link", { name: "Documents" }).click();
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(page.getByText("No documents yet.")).toBeVisible();

    const text = `# Travel policy\n\n${"Book trains for trips under four hours. ".repeat(60)}\n\nThe zephyrine allowance is 40 euros a day.`;
    await page.getByTestId("document-input").setInputFiles({
      name: "travel-policy.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(text),
    });

    const list = page.getByRole("list", { name: "Documents" });
    await expect(list.getByText("travel-policy.md")).toBeVisible();
    // Upload, SQS event, worker: parse, chunk, embed, index.
    await expect(list.getByText(/Ready, \d+ passages?/)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("searchbox", { name: "Search documents" }).fill("zephyrine allowance");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const results = page.getByRole("list", { name: "Search results" });
    await expect(results.getByText(/zephyrine allowance is 40 euros/).first()).toBeVisible();
  });

  test("refuses files it can't index", async ({ page }) => {
    await signUp(page);
    await page.goto("/documents");
    await page.getByTestId("document-input").setInputFiles({
      name: "installer.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("MZ"),
    });
    await expect(
      page.getByText("Upload a PDF, Word, text, Markdown, CSV, JSON, or HTML file"),
    ).toBeVisible();
  });

  test("deletes a document", async ({ page }) => {
    await signUp(page);
    await page.goto("/documents");
    await page.getByTestId("document-input").setInputFiles({
      name: "old-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Old notes that should go."),
    });
    const list = page.getByRole("list", { name: "Documents" });
    await expect(list.getByText(/Ready/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Options for old-notes.txt" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("dialog", { name: "Delete document?" })
      .getByRole("button", { name: "Delete document" })
      .click();
    await expect(page.getByText("No documents yet.")).toBeVisible();
  });

  test("answers from a document with a citation to the passage", async ({ page }) => {
    await signUp(page);
    await page.goto("/documents");
    await page.getByTestId("document-input").setInputFiles({
      name: "travel-policy.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Travel\n\nThe zephyrine allowance is 40 euros a day."),
    });
    await expect(page.getByRole("list", { name: "Documents" }).getByText(/Ready/)).toBeVisible({
      timeout: 30_000,
    });

    await page.goto("/chat");
    await page.getByRole("textbox", { name: "Message" }).fill("What is the zephyrine allowance?");
    await page.getByRole("button", { name: "Send message" }).click();

    const messages = page.getByRole("list", { name: "Messages" });
    const chip = messages.getByRole("button", { name: "Source 1: travel-policy.md" });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(
      page.getByRole("dialog").getByText("The zephyrine allowance is 40 euros a day."),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(messages.getByRole("list", { name: "Sources" })).toContainText("travel-policy.md");

    // Turning documents off answers without searching.
    await page.getByRole("button", { name: /^Use documents:/ }).click();
    await page.getByRole("menuitem", { name: /^Off/ }).click();
    await page.getByRole("textbox", { name: "Message" }).fill("And the zephyrine allowance again?");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(messages.getByText("Echo: And the zephyrine allowance again?")).toBeVisible();
    await expect(messages.getByRole("button", { name: /^Source / })).toHaveCount(1);
  });
});
