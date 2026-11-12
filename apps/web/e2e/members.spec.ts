import { expect, test, type Page } from "@playwright/test";
import {
  confirmEmailFromLink,
  latestEmail,
  openNavigation,
  PASSWORD,
  setName,
  signUp,
  uniqueEmail,
} from "./helpers";

async function createTeamWorkspace(page: Page, name: string) {
  await openNavigation(page);
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "New workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "New workspace" });
  await dialog.getByLabel("Workspace name").fill(name);
  await dialog.getByRole("button", { name: "Create workspace" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("workspace members", () => {
  test("invites someone who signs up from the email and joins", async ({ page, browser }) => {
    await signUp(page, { name: "Grace Hopper" });
    await createTeamWorkspace(page, "Compiler team");
    await page.goto("/members");
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();

    const email = uniqueEmail();
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: `Invitation sent to ${email}` }),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "Pending invitations" })).toContainText(email);

    // The invitee opens the link from the email in their own browser.
    const { match } = await latestEmail(page, email, /(\/invite\/[\w-]+)/);
    const invitee = await (await browser.newContext()).newPage();
    await invitee.goto(match[1]!);
    await expect(invitee.getByRole("heading", { name: "Join Compiler team" })).toBeVisible();
    await expect(invitee.getByText("Grace Hopper invited")).toBeVisible();
    await invitee.getByRole("link", { name: "Create an account" }).click();
    await invitee.getByLabel("Email").fill(email);
    await invitee.getByLabel("Password").fill(PASSWORD);
    await invitee.getByRole("button", { name: "Create account" }).click();

    // Back on the invitation once signed in. Joining needs the email confirmed first.
    await invitee.getByRole("button", { name: "Join Compiler team" }).click();
    await expect(
      invitee.getByRole("alert").filter({ hasText: "Confirm your email first" }),
    ).toBeVisible();
    await confirmEmailFromLink(invitee, email);
    await setName(invitee, "Ada Lovelace");
    await invitee.goto(match[1]!);
    await invitee.getByRole("button", { name: "Join Compiler team" }).click();
    await expect(invitee).toHaveURL(/\/chat$/);
    await openNavigation(invitee);
    await expect(invitee.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Compiler team",
    );

    // The owner sees them, makes them an admin, then removes them.
    await page.reload();
    const people = page.getByRole("list", { name: "Members" });
    await expect(people).toContainText("Ada Lovelace");
    await expect(page.getByRole("list", { name: "Pending invitations" })).toHaveCount(0);
    await people.getByLabel("Role for Ada Lovelace").selectOption("admin");
    await expect(
      page.getByRole("status").filter({ hasText: "Ada Lovelace is now an admin" }),
    ).toBeVisible();
    await people.getByRole("button", { name: "Remove Ada Lovelace" }).click();
    await page
      .getByRole("dialog", { name: "Remove Ada Lovelace?" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(people).not.toContainText("Ada Lovelace");

    // Every step is in the workspace's activity.
    await page.goto("/settings");
    const activity = page.getByRole("list", { name: "Activity" });
    await expect(activity).toContainText("Grace Hopper removed a member");
    await expect(activity).toContainText("Grace Hopper changed a member from member to admin");
    await expect(activity).toContainText("Ada Lovelace joined");
    await expect(activity).toContainText(`Grace Hopper invited ${email} as a member`);
  });

  test("explains that a personal workspace is just for you", async ({ page }) => {
    await signUp(page);
    await page.goto("/members");
    await expect(page.getByText("is your personal workspace")).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create a team workspace" })).toBeVisible();
  });

  test("tells a signed-in user when an invitation is for someone else", async ({
    page,
    browser,
  }) => {
    const owner = await (await browser.newContext()).newPage();
    await signUp(owner);
    await createTeamWorkspace(owner, "Ops");
    await owner.goto("/members");
    const email = uniqueEmail();
    await owner.getByLabel("Email address").fill(email);
    await owner.getByRole("button", { name: "Send invitation" }).click();
    const { match } = await latestEmail(owner, email, /(\/invite\/[\w-]+)/);

    const { email: mine } = await signUp(page);
    await page.goto(match[1]!);
    await expect(page.getByText(`You're signed in as ${mine}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Join Ops" })).toHaveCount(0);
  });
});
