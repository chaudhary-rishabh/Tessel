import { expect, test, type Page } from "@playwright/test";
import { openNavigation, signUp } from "./helpers";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const messages = (page: Page) => page.getByRole("list", { name: "Messages" });

async function sendMessage(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.describe("chat", () => {
  test("streams a reply into a new chat and keeps it after a reload", async ({ page }) => {
    await signUp(page);
    await sendMessage(page, "Plan the team offsite in March");

    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
    await expect(messages(page).getByText("Echo: Plan the team offsite in March")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

    await openNavigation(page);
    await expect(page.getByRole("link", { name: "Plan the team offsite" })).toBeVisible();

    await page.reload();
    await expect(
      messages(page).getByText("Plan the team offsite in March", { exact: true }),
    ).toBeVisible();
    await expect(messages(page).getByText("Echo: Plan the team offsite in March")).toBeVisible();
  });

  test("continues a chat with earlier messages", async ({ page }) => {
    await signUp(page);
    await sendMessage(page, "First message");
    await expect(messages(page).getByText("Echo: First message")).toBeVisible();
    await sendMessage(page, "Second message");
    await expect(messages(page).getByText("Echo: Second message")).toBeVisible();
    await expect(messages(page).getByRole("listitem")).toHaveCount(4);
  });

  test("stops a reply and keeps what was written", async ({ page }) => {
    await signUp(page);
    await sendMessage(page, "MOCK_SLOW");
    await expect(messages(page).getByText(/word3/)).toBeVisible();
    await page.getByRole("button", { name: "Stop response" }).click();

    await expect(messages(page).getByText("Stopped")).toBeVisible();
    await expect(messages(page).getByText(/word199/)).toHaveCount(0);
    await page.reload();
    await expect(messages(page).getByText("Stopped")).toBeVisible();
  });

  test("attaches a text file and an image", async ({ page }) => {
    await signUp(page);
    await page.getByTestId("attach-input").setInputFiles([
      { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Goals\nShip chat") },
      { name: "chart.png", mimeType: "image/png", buffer: PNG },
    ]);
    await expect(page.getByText("notes.md")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
    await composer(page).fill("What do these say?");
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
    await page.getByRole("button", { name: "Send message" }).click();

    // The mock gateway echoes the message, including the inlined file, and counts images.
    await expect(messages(page).getByText(/Ship chat\s*<\/attachment> \[1 image\]/)).toBeVisible();
    await expect(messages(page).getByText("notes.md", { exact: true })).toBeVisible();
    await expect(messages(page).getByText("chart.png", { exact: true })).toBeVisible();
  });

  test("explains a refused message and gives the text back", async ({ page }) => {
    await signUp(page);
    await sendMessage(page, "MOCK_BLOCK details");
    await expect(page.getByRole("alert").filter({ hasText: "usage policy" })).toBeVisible();
    await expect(composer(page)).toHaveValue("MOCK_BLOCK details");
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("remembers the chosen model for new chats", async ({ page }) => {
    await signUp(page);
    await page.getByRole("button", { name: /^Model:/ }).click();
    await page.getByRole("menuitem", { name: /GPT-5.4 mini/ }).click();
    await expect(page.getByRole("button", { name: "Model: GPT-5.4 mini" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Model: GPT-5.4 mini" })).toBeVisible();
  });

  test("renames and deletes a chat from the sidebar", async ({ page }) => {
    await signUp(page);
    await sendMessage(page, "Quarterly planning notes");
    await expect(messages(page).getByText("Echo: Quarterly planning notes")).toBeVisible();

    await openNavigation(page);
    await page.getByRole("button", { name: "Options for Quarterly planning notes" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const rename = page.getByRole("dialog", { name: "Rename chat" });
    await rename.getByLabel("Title").fill("Q3 planning");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("link", { name: "Q3 planning" })).toBeVisible();

    await page.getByRole("button", { name: "Options for Q3 planning" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("dialog", { name: "Delete chat?" })
      .getByRole("button", { name: "Delete chat" })
      .click();
    await expect(page).toHaveURL(/\/chat$/);
    await openNavigation(page);
    await expect(
      page.getByText("Your conversations will appear here.").locator("visible=true"),
    ).toBeVisible();
  });
});
