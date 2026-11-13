import { expect, test, type Page } from "@playwright/test";
import { openNavigation, signUp } from "./helpers";

async function createTeamWorkspace(page: Page, name: string) {
  await openNavigation(page);
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "New workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "New workspace" });
  await dialog.getByLabel("Workspace name").fill(name);
  await dialog.getByRole("button", { name: "Create workspace" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("workspace policies", () => {
  test("an owner blocks a connector, turns a tool off, and turns a built-in skill off", async ({
    page,
  }) => {
    await signUp(page);
    await createTeamWorkspace(page, "Policy team");

    await page.goto("/settings#policies");
    const section = page.getByRole("region", { name: "Workspace policies" });
    await section.getByLabel("Policy for Calculate").selectOption("block");
    await expect(section.getByLabel("Policy for Calculate")).toHaveValue("block");
    // Clicked, not check(): the box turns on when the change is saved, not on the click itself.
    await section.getByRole("checkbox", { name: "Block GitHub" }).click();
    await expect(section.getByRole("checkbox", { name: "Block GitHub" })).toBeChecked();
    await page.reload();
    await expect(section.getByLabel("Policy for Calculate")).toHaveValue("block");
    await expect(section.getByRole("checkbox", { name: "Block GitHub" })).toBeChecked();

    await page.goto("/connectors");
    await expect(page.getByText("Blocked by your admins")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect GitHub" })).toHaveCount(0);

    await page.goto("/skills");
    const meeting = page.getByRole("switch", { name: "Use Meeting notes" });
    await expect(meeting).toBeChecked();
    await meeting.click();
    await expect(meeting).not.toBeChecked();
    await page.reload();
    await expect(page.getByRole("switch", { name: "Use Meeting notes" })).not.toBeChecked();
  });
});

test.describe("skill files", () => {
  test("adds a template to a skill and removes it", async ({ page }) => {
    await signUp(page);
    await page.goto("/skills");
    await page.getByRole("button", { name: "New skill" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Weekly report");
    await dialog.getByLabel("When to use it").fill("Write the weekly team report");
    await dialog.getByLabel("Instructions").fill("Fill in report-template.md.");
    await dialog.getByRole("button", { name: "Create skill" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Options for Weekly report" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await page.getByTestId("skill-file-input").setInputFiles({
      name: "report-template.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Week of …\n## Done\n## Next"),
    });
    const files = page.getByRole("list", { name: "Skill files" });
    await expect(files.getByText("report-template.md")).toBeVisible();
    await files.getByRole("button", { name: "Remove report-template.md" }).click();
    await expect(files).toBeHidden();
  });
});
