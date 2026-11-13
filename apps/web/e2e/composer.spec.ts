import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

test.describe("composer", () => {
  test("picks a skill with a slash for the next message", async ({ page }) => {
    await signUp(page);
    await composer(page).fill("/meet");
    const skills = page.getByRole("listbox", { name: "Skills" });
    await expect(skills.getByRole("option", { name: /Meeting notes/ })).toBeVisible();
    await composer(page).press("Enter");
    await expect(skills).toBeHidden();
    await expect(page.getByText("Using Meeting notes")).toBeVisible();
    await expect(composer(page)).toHaveValue("");

    await composer(page).fill("Notes from today's standup");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page.getByRole("list", { name: "Messages" }).getByText(/Echo: Notes from today/),
    ).toBeVisible();
    // It applied to that message only.
    await expect(page.getByText("Using Meeting notes")).toHaveCount(0);
  });

  test("suggests Plan for a multi-step request without switching on its own", async ({ page }) => {
    await signUp(page);
    await composer(page).fill(
      "Help me get ready for the launch:\n1. List the open issues\n2. Group them by owner\n3. Draft a short status note",
    );
    await expect(page.getByText("Looks like several steps.")).toBeVisible();
    await page.getByRole("button", { name: "Use Plan" }).click();
    await expect(page.getByRole("button", { name: "Reply mode: Plan" })).toBeVisible();
    await expect(page.getByText("Looks like several steps.")).toHaveCount(0);
  });
});
