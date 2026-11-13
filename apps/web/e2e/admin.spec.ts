import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { logOut, PASSWORD, signUp } from "./helpers";

const ADMIN_URL = "http://localhost:3001";

/** Admins are made with the operator's command, never through the app. */
function grantAdmin(email: string) {
  execFileSync("pnpm", ["--filter", "@tessel/db", "grant-admin", email], {
    cwd: resolve(import.meta.dirname, "../../.."),
    stdio: "pipe",
  });
}

/** Goes to a section: the sidebar on desktop, the menu on phones. */
async function goTo(page: Page, section: string) {
  const phone = (page.viewportSize()?.width ?? 1280) < 768;
  // Retried: the dev server can reload the page while it compiles a route.
  await expect(async () => {
    if (phone && (await page.getByRole("button", { name: "Open navigation" }).isVisible())) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: section })
      .filter({ visible: true })
      .click({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("admin app", () => {
  test("turns away people who aren't admins", async ({ page }) => {
    await signUp(page);
    // The admin app shares the session with the main app.
    await page.goto(ADMIN_URL);
    await expect(
      page.getByRole("heading", { name: "This account isn't a Tessel admin" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });

  test("suspends and restores an account, and records it", async ({ page, browser }) => {
    const target = await (await browser.newContext()).newPage();
    const { email: targetEmail } = await signUp(target, { name: "Suspended Sam" });
    await logOut(target);

    const { email } = await signUp(page, { name: "Admin Ada" });
    grantAdmin(email);
    await page.goto(ADMIN_URL);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /^\d/ }).first()).toBeVisible();

    // The theme can be picked here too, and stays picked.
    if ((page.viewportSize()?.width ?? 1280) >= 768) {
      await page.getByTitle("Dark").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.reload();
      await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    }

    await goTo(page, "Users");
    await page.getByLabel("Search by name or email").fill(targetEmail);
    await page.getByRole("link", { name: "Suspended Sam" }).click();
    await expect(page.getByRole("heading", { name: "Suspended Sam" })).toBeVisible();
    await page.getByRole("button", { name: "Suspend" }).click();
    await page
      .getByRole("dialog", { name: "Suspend this account?" })
      .getByRole("button", { name: "Suspend" })
      .click();
    await expect(page.getByRole("button", { name: "Lift suspension" })).toBeVisible();

    // The suspended person can't log in to Tessel.
    await target.getByLabel("Email").fill(targetEmail);
    await target.getByLabel("Password").fill(PASSWORD);
    await target.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(
      target.getByRole("alert").filter({ hasText: "This account is suspended" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Lift suspension" }).click();
    await page
      .getByRole("dialog", { name: "Lift the suspension?" })
      .getByRole("button", { name: "Lift suspension" })
      .click();
    await expect(page.getByRole("button", { name: "Suspend" })).toBeVisible();
    await target.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(target).toHaveURL(/\/chat$/);

    await goTo(page, "Audit log");
    await page.getByLabel("Show").selectOption("admin.");
    const log = page.getByRole("list", { name: "Audit events" });
    await expect(log).toContainText("Lifted a suspension");
    await expect(log).toContainText("Suspended an account");
  });

  test("changes a model's price in the registry", async ({ page }) => {
    const { email } = await signUp(page);
    grantAdmin(email);
    await page.goto(`${ADMIN_URL}/models`);
    await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();

    const price = page.getByLabel("GPT-5.5 output price per million tokens");
    const original = await price.inputValue();
    await price.fill("31.5");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved. The registry is updated.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("GPT-5.5 output price per million tokens")).toHaveValue("31.5");
    await expect(page.getByText(/^Last saved/)).toBeVisible();

    // Put it back.
    await page.getByLabel("GPT-5.5 output price per million tokens").fill(original);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved. The registry is updated.")).toBeVisible();
  });

  test("works on a phone-sized screen", async ({ page }) => {
    const { email } = await signUp(page);
    grantAdmin(email);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ADMIN_URL}/usage`);
    await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
    await goTo(page, "Users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });
});
