import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "a long enough password";

export function uniqueEmail(): string {
  return `e2e-${randomUUID().slice(0, 8)}@example.com`;
}

export async function signUp(page: Page, { name = "Ada Lovelace", email = uniqueEmail() } = {}) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  return { name, email };
}

/** Opens the navigation: always visible on desktop, a drawer on phones. */
export async function openNavigation(page: Page) {
  const menuButton = page.getByRole("button", { name: "Open navigation" });
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }
}

export async function logOut(page: Page) {
  await openNavigation(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}
