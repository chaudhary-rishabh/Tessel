import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { latestTextedCode, logOut, signUp, uniqueEmail } from "./helpers";

/** Fills in the mock provider's sign-in page, as a person would on Google's or GitHub's. */
async function approveAtProvider(
  page: Page,
  provider: "Google" | "GitHub",
  {
    email,
    name = "Ada Lovelace",
    verified = true,
  }: { email: string; name?: string; verified?: boolean },
) {
  await expect(page.getByRole("heading", { name: `Sign in with ${provider}` })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Name").fill(name);
  if (!verified) await page.getByLabel("Email verified").uncheck();
  await page.getByRole("button", { name: "Continue" }).click();
}

const uniquePhone = () => `+9199${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;

test.describe("signing in with Google, GitHub, and a phone", () => {
  test("signs up with Google, then logs back in with it", async ({ page }) => {
    const email = uniqueEmail();
    await page.goto("/signup");
    await page.getByRole("link", { name: "Continue with Google" }).click();
    await approveAtProvider(page, "Google", { email, name: "Grace Hopper" });
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Grace");

    await logOut(page);
    await page.getByRole("link", { name: "Continue with Google" }).click();
    await approveAtProvider(page, "Google", { email, name: "Grace Hopper" });
    await expect(page).toHaveURL(/\/chat$/);

    // No password yet: Settings offers to set one instead of changing it.
    await page.goto("/settings");
    const methods = page.getByRole("list", { name: "Sign-in methods" });
    await expect(methods).toContainText("Not set");
    await expect(methods).toContainText(email);
    await expect(page.getByRole("region", { name: "Password" })).toHaveCount(0);
  });

  test("GitHub joins the account that has the same email, and returns to the page asked for", async ({
    page,
  }) => {
    const { email } = await signUp(page);
    await logOut(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
    await page.getByRole("link", { name: "Continue with GitHub" }).click();
    await approveAtProvider(page, "GitHub", { email });
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("list", { name: "Sign-in methods" })).toContainText("GitHub");
    await expect(page.getByRole("button", { name: "Unlink GitHub" })).toBeVisible();
  });

  test("won't use an email the provider hasn't verified", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Continue with Google" }).click();
    await approveAtProvider(page, "Google", { email: uniqueEmail(), verified: false });
    await expect(page).toHaveURL(/\/login\?error=email_unverified$/);
    await expect(
      page.getByRole("alert").filter({ hasText: "email address isn't verified" }),
    ).toBeVisible();
  });

  test("links and unlinks Google from Settings", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Link Google" }).click();
    const googleEmail = uniqueEmail();
    await approveAtProvider(page, "Google", { email: googleEmail });
    await expect(page).toHaveURL(/\/settings\?linked=google/);
    await expect(page.getByText("Google is linked. You can log in with it now.")).toBeVisible();
    const methods = page.getByRole("list", { name: "Sign-in methods" });
    await expect(methods).toContainText(googleEmail);

    await page.getByRole("button", { name: "Unlink Google" }).click();
    await expect(page.getByRole("button", { name: "Link Google" })).toBeVisible();
  });

  test("adds a phone number, then logs in with a texted code", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Add number" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a mobile number" });
    const phone = uniquePhone();
    await dialog.getByLabel("Mobile number").fill(`${phone.slice(0, 3)} ${phone.slice(3)}`);
    await dialog.getByRole("button", { name: "Text me a code" }).click();
    await expect(dialog).toContainText(`Enter the code we texted to ${phone}`);
    await dialog.getByLabel("Code from the text message").fill(await latestTextedCode(page, phone));
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("list", { name: "Sign-in methods" })).toContainText(phone);

    await logOut(page);
    await page.getByRole("button", { name: "Use a text message instead" }).click();
    await page.getByLabel("Mobile number").fill(phone);
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByRole("status").filter({ hasText: phone })).toBeVisible();
    await page.getByLabel("Code from the text message").fill(await latestTextedCode(page, phone));
    await expect(page).toHaveURL(/\/chat$/);
  });
});
