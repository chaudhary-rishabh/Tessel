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
});
