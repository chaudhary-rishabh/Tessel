import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

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
});
