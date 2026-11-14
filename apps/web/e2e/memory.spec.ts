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

test.describe("memory", () => {
  test("what Tessel is asked to remember shows in Settings, where it can be edited", async ({
    page,
  }) => {
    await signUp(page);
    await page
      .getByRole("textbox", { name: "Message" })
      .fill(
        `MOCK_TOOLS ${JSON.stringify([{ name: "remember", args: { content: "Prefers short answers." } }])}`,
      );
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page
        .getByRole("list", { name: "Messages" })
        .getByText("Tool result: Saved to memory: Prefers short answers."),
    ).toBeVisible();

    await page.goto("/settings");
    const section = page.getByRole("region", { name: "Memory" });
    const list = section.getByRole("list", { name: "Memories" });
    await expect(list).toContainText("Prefers short answers.");
    await expect(list).toContainText("You asked Tessel to remember");

    await section.getByLabel("Add a memory").fill("Works on the payments team.");
    await section.getByRole("button", { name: "Add memory" }).click();
    await expect(list).toContainText("Added by you");

    await list.getByRole("button", { name: 'Edit "Works on the payments team."' }).click();
    await list.getByLabel("Edit memory").fill("Leads the payments team.");
    await list.getByRole("button", { name: "Save memory" }).click();
    await expect(list).toContainText("Leads the payments team.");

    await list.getByRole("button", { name: 'Delete "Prefers short answers."' }).click();
    await expect(list).not.toContainText("Prefers short answers.");
    await page.reload();
    await expect(page.getByRole("list", { name: "Memories" })).toContainText(
      "Leads the payments team.",
    );
  });

  test("a reply that saves a memory says so, and can undo it", async ({ page }) => {
    await signUp(page);
    await page
      .getByRole("textbox", { name: "Message" })
      .fill(
        `MOCK_TOOLS ${JSON.stringify([{ name: "remember", args: { content: "Uses metric units." } }])}`,
      );
    await page.getByRole("button", { name: "Send message" }).click();
    const messages = page.getByRole("list", { name: "Messages" });
    const note = messages.getByRole("status").filter({ hasText: "Memory updated" });
    await expect(note).toContainText("Memory updated: Uses metric units.");
    await note.getByRole("button", { name: "Undo" }).click();
    await expect(messages.getByText("Removed from memory.")).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByRole("region", { name: "Memory" })).not.toContainText(
      "Uses metric units.",
    );
  });

  test("memory and chat search can be switched off", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings");
    const memorySwitch = page.getByRole("switch", { name: "Remember things about me" });
    const searchSwitch = page.getByRole("switch", { name: "Search my past chats" });
    await expect(memorySwitch).toHaveAttribute("aria-checked", "true");
    await memorySwitch.click();
    await searchSwitch.click();
    await expect(memorySwitch).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(page.getByRole("switch", { name: "Remember things about me" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByRole("switch", { name: "Search my past chats" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("a team workspace shares team memory, which replies use", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings");
    // A personal workspace has only personal memory.
    await expect(page.getByRole("region", { name: "Team memory" })).toHaveCount(0);

    await createTeamWorkspace(page, "Payments");
    await page.goto("/settings");
    const section = page.getByRole("region", { name: "Team memory" });
    await section.getByLabel("Add to team memory").fill("Releases ship on Thursdays.");
    await section.getByRole("button", { name: "Add for the team" }).click();
    const list = section.getByRole("list", { name: "Team memory" });
    await expect(list).toContainText("Releases ship on Thursdays.");
    await expect(list).toContainText("Added by you");

    // Asking in a chat adds to it once allowed.
    await page.goto("/chat");
    await page
      .getByRole("textbox", { name: "Message" })
      .fill(
        `MOCK_TOOLS ${JSON.stringify([{ name: "remember_for_team", args: { content: "Staging is at staging.acme.dev." } }])}`,
      );
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page.getByText('Add to team memory: "Staging is at staging.acme.dev."'),
    ).toBeVisible();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(
      page
        .getByRole("list", { name: "Messages" })
        .getByText("Tool result: Saved to team memory: Staging is at staging.acme.dev."),
    ).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByRole("list", { name: "Team memory" })).toContainText(
      "Staging is at staging.acme.dev.",
    );
    await page
      .getByRole("list", { name: "Team memory" })
      .getByRole("button", { name: 'Delete "Releases ship on Thursdays."' })
      .click();
    await expect(page.getByRole("list", { name: "Team memory" })).not.toContainText("Thursdays");
  });
});
