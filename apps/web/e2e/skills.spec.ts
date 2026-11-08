import { expect, test } from "@playwright/test";
import { openNavigation, signUp } from "./helpers";

test.describe("skills", () => {
  test("a skill the user writes changes how Tessel answers", async ({ page }) => {
    await signUp(page);
    await openNavigation(page);
    await page.getByRole("link", { name: "Skills" }).click();
    await expect(page.getByRole("heading", { name: "Skills", level: 1 })).toBeVisible();
    await expect(page.getByRole("list", { name: "Built-in skills" })).toContainText(
      "Meeting notes",
    );

    await page.getByRole("button", { name: "New skill" }).click();
    const dialog = page.getByRole("dialog", { name: "New skill" });
    await dialog.getByLabel("Name").fill("Release notes");
    await dialog.getByLabel("When to use it").fill("Write release notes for a product update");
    await dialog
      .getByLabel("Instructions")
      .fill("Start with RELEASE-NOTES-OK.\nThen group changes by area.");
    await dialog.getByRole("button", { name: "Create skill" }).click();
    await expect(dialog).toHaveCount(0);

    const list = page.getByRole("list", { name: "Workspace skills" });
    await expect(list).toContainText("Release notes");
    await expect(list).toContainText("release-notes");
    await expect(list.getByRole("switch", { name: "Use Release notes" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await page.goto("/chat");
    await page.getByRole("textbox", { name: "Message" }).fill("MOCK_SKILL release-notes for v2");
    await page.getByRole("button", { name: "Send message" }).click();
    const messages = page.getByRole("list", { name: "Messages" });
    await expect(
      messages.getByText("Following the Release notes skill: Start with RELEASE-NOTES-OK."),
    ).toBeVisible();
    await expect(messages.getByRole("button", { name: /Use a skill/ })).toBeVisible();
  });

  test("edits, turns off, and deletes a skill", async ({ page }) => {
    await signUp(page);
    await page.goto("/skills");
    await page.getByRole("button", { name: "New skill" }).click();
    const dialog = page.getByRole("dialog", { name: "New skill" });
    await dialog.getByLabel("Name").fill("Weekly update");
    await dialog.getByLabel("When to use it").fill("Write the team's weekly status update");
    await dialog.getByLabel("Instructions").fill("Three sections: done, next, blocked.");
    await dialog.getByRole("button", { name: "Create skill" }).click();

    const list = page.getByRole("list", { name: "Workspace skills" });
    await list.getByRole("button", { name: "Options for Weekly update" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const editor = page.getByRole("dialog", { name: "Edit Weekly update" });
    await editor.getByLabel("Name").fill("Status update");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(list).toContainText("status-update");

    const toggle = list.getByRole("switch", { name: "Use Status update" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(page.getByRole("switch", { name: "Use Status update" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await page.getByRole("button", { name: "Options for Status update" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete skill" }).click();
    await expect(page.getByText("No skills yet.")).toBeVisible();
  });

  test("explains why a skill name can't be used", async ({ page }) => {
    await signUp(page);
    await page.goto("/skills");
    await page.getByRole("button", { name: "New skill" }).click();
    const dialog = page.getByRole("dialog", { name: "New skill" });
    await dialog.getByLabel("Name").fill("Meeting notes");
    await dialog.getByLabel("When to use it").fill("My own version of meeting notes");
    await dialog.getByLabel("Instructions").fill("Use bullet points everywhere.");
    await dialog.getByRole("button", { name: "Create skill" }).click();
    await expect(dialog.getByRole("alert")).toContainText("A built-in skill already has this name");
  });
});
