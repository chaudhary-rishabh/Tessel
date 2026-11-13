import { expect, test } from "@playwright/test";
import { openNavigation, signUp } from "./helpers";

/** Two seconds of a tone, as a WAV file: a stand-in recording the mock transcribes as a meeting. */
function toneWav(seconds = 2, rate = 8000): Buffer {
  const data = Buffer.alloc(seconds * rate * 2);
  for (let i = 0; i < seconds * rate; i++) {
    data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

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
      page.getByText(
        "Upload a PDF, Word, Excel, PowerPoint, text, Markdown, CSV, JSON, or HTML file, or an audio or video recording",
      ),
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

  test("transcribes a recording and answers from it, citing the moment", async ({ page }) => {
    await signUp(page);
    await page.goto("/documents");
    await page.getByTestId("document-input").setInputFiles({
      name: "product-review.wav",
      mimeType: "audio/wav",
      buffer: toneWav(),
    });
    const list = page.getByRole("list", { name: "Documents" });
    await expect(list.getByText("product-review.wav")).toBeVisible();
    // Upload, worker: speech audio, transcription, chunks, embeddings.
    await expect(list.getByText(/Ready, \d+ passages?/)).toBeVisible({ timeout: 45_000 });

    await page.goto("/chat");
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("When does the mobile launch move to?");
    await page.getByRole("button", { name: "Send message" }).click();
    const chip = page
      .getByRole("list", { name: "Messages" })
      .getByRole("button", { name: "Source 1: product-review.wav" });
    await expect(chip).toBeVisible();
    await chip.click();
    // The passage says where in the recording it is.
    await expect(
      page.getByRole("dialog").getByText(/\[0:00\] Welcome to the weekly product review/),
    ).toBeVisible();
    await expect(page.getByRole("dialog").getByText(/May 14th/)).toBeVisible();
  });

  test("uploads a big recording in parts", async ({ page }) => {
    test.setTimeout(90_000);
    await signUp(page);
    await page.goto("/documents");
    // About 12 minutes of a tone: 11 MB, so it goes up in three parts.
    await page.getByTestId("document-input").setInputFiles({
      name: "all-hands.wav",
      mimeType: "audio/wav",
      buffer: toneWav(700),
    });
    const list = page.getByRole("list", { name: "Documents" });
    await expect(list.getByText("all-hands.wav")).toBeVisible();
    await expect(list.getByText(/Ready, \d+ passages?/)).toBeVisible({ timeout: 60_000 });
  });

  test("searches only the documents picked for a question", async ({ page }) => {
    await signUp(page);
    await page.goto("/documents");
    await page.getByTestId("document-input").setInputFiles([
      {
        name: "travel-policy.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Travel\n\nThe zephyrine allowance is 40 euros a day."),
      },
      {
        name: "old-policy.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Old travel\n\nThe zephyrine allowance was 25 euros a day."),
      },
    ]);
    await expect(page.getByRole("list", { name: "Documents" }).getByText(/Ready/)).toHaveCount(2, {
      timeout: 30_000,
    });

    await page.goto("/chat");
    await page.getByRole("button", { name: /^Use documents:/ }).click();
    await page.getByRole("menuitem", { name: /^Choose documents/ }).click();
    const chooser = page.getByRole("dialog", { name: "Choose documents" });
    await chooser.getByRole("checkbox", { name: "old-policy.md" }).check();
    await chooser.getByRole("button", { name: "Search 1 document" }).click();
    await expect(page.getByText("Searching old-policy.md")).toBeVisible();

    await page.getByRole("textbox", { name: "Message" }).fill("What is the zephyrine allowance?");
    await page.getByRole("button", { name: "Send message" }).click();
    const messages = page.getByRole("list", { name: "Messages" });
    await expect(messages.getByRole("button", { name: "Source 1: old-policy.md" })).toBeVisible();
    await expect(messages.getByRole("button", { name: /travel-policy\.md/ })).toHaveCount(0);
  });
});
