import { expect, test } from "@playwright/test";
import { logOut, openNavigation, PASSWORD, signUp } from "./helpers";

test.describe("workspace and settings", () => {
  test("creates a team workspace and switches to it", async ({ page }) => {
    await signUp(page);
    await openNavigation(page);
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "New workspace" }).click();

    const dialog = page.getByRole("dialog", { name: "New workspace" });
    await dialog.getByLabel("Workspace name").fill("Platform team");
    await dialog.getByRole("button", { name: "Create workspace" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Platform team",
    );
  });

  test("renames the current workspace", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings");
    const name = page.getByLabel("Workspace name");
    await expect(name).toHaveValue("Ada's workspace");

    await name.fill("Research lab");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText("Workspace renamed.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Workspace name")).toHaveValue("Research lab");
  });

  test("changes the password", async ({ page }) => {
    const { email } = await signUp(page);
    await page.goto("/settings");
    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password").fill("an even longer passphrase");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed.")).toBeVisible();

    // Still signed in on this device after the change.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Only the new password works from now on.
    await logOut(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("an even longer passphrase");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("rejects a wrong current password", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings");
    await page.getByLabel("Current password").fill("not my password");
    await page.getByLabel("New password").fill("an even longer passphrase");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Current password is incorrect")).toBeVisible();
  });

  test("navigates between pages from the sidebar", async ({ page }) => {
    await signUp(page);
    await openNavigation(page);
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    // On phones the drawer closes after navigating.
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden();
  });
});
