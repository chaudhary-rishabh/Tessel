import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

const messages = (page: Page) => page.getByRole("list", { name: "Messages" });

async function pickMode(page: Page, label: "Answer" | "Plan" | "Review" | "Team") {
  await page.getByRole("button", { name: /^Reply mode:/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click();
  await expect(page.getByRole("button", { name: `Reply mode: ${label}` })).toBeVisible();
}

async function sendMessage(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.describe("reply modes", () => {
  test("plans the work, shows each step, and remembers the mode", async ({ page }) => {
    await signUp(page);
    await pickMode(page, "Plan");
    await sendMessage(page, "Compare our two offices");

    await expect(messages(page).getByText("Answer from 2 results.")).toBeVisible();
    const panel = messages(page).getByRole("region", { name: "How this reply was worked out" });
    const header = panel.getByRole("button", { name: "Worked through a 2-step plan" });
    await expect(header).toBeVisible();
    await header.click();
    await expect(panel.getByRole("list", { name: "Stages" })).toContainText("Gather the facts");
    await expect(panel.getByRole("list", { name: "Stages" })).toContainText("Work out the answer");

    // The choice sticks for the next message, even after a reload.
    await page.reload();
    await expect(page.getByRole("button", { name: "Reply mode: Plan" })).toBeVisible();
    await expect(
      messages(page).getByRole("button", { name: "Worked through a 2-step plan" }),
    ).toBeVisible();
  });

  test("reviews a draft and shows that it was revised", async ({ page }) => {
    await signUp(page);
    await pickMode(page, "Review");
    await sendMessage(page, "MOCK_CRITIQUE explain caching");
    await expect(messages(page).getByText("Revised answer with a one-line summary.")).toBeVisible();
    await expect(
      messages(page).getByRole("button", { name: "Reviewed and revised" }),
    ).toBeVisible();
  });

  test("hands work to the team", async ({ page }) => {
    await signUp(page);
    await pickMode(page, "Team");
    await sendMessage(page, "What do our documents say about travel?");
    await expect(messages(page).getByText("Answer from 1 reports.")).toBeVisible();
    const header = messages(page).getByRole("button", { name: "Worked with 1 teammate" });
    await header.click();
    await expect(messages(page).getByText("Researcher: Task for researcher")).toBeVisible();
  });
});
