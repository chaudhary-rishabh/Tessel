import { expect, test, type Page } from "@playwright/test";
import { latestEmail, logOut, PASSWORD, signUp, totpCode } from "./helpers";

const NEW_PASSWORD = "a brand new passphrase";

async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

test.describe("account security", () => {
  test("resets a forgotten password from the emailed link", async ({ page }) => {
    const { email } = await signUp(page);
    await logOut(page);

    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText(email);

    const { match } = await latestEmail(page, email, /(\/reset-password\?token=[\w-]+)/);
    await page.goto(match[1]!);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill("something else entirely");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The passwords don't match")).toBeVisible();
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();

    // The link works once.
    await page.goto(match[1]!);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "expired or was already used" }),
    ).toBeVisible();

    await page.goto("/login");
    await logIn(page, email, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("turns on two-step sign-in, then signs in with a code and a recovery code", async ({
    page,
  }) => {
    const { email } = await signUp(page);
    await page.goto("/settings");
    const section = page.getByRole("region", { name: "Two-step sign-in" });
    await section.getByRole("button", { name: "Turn on two-step sign-in" }).click();

    const dialog = page.getByRole("dialog", { name: "Turn on two-step sign-in" });
    await expect(
      dialog.getByRole("img", { name: "QR code for your authenticator app" }),
    ).toBeVisible();
    await dialog.getByText("Can't scan it? Enter a key instead").click();
    const secret = (await dialog.getByTestId("totp-secret").textContent())!.trim();
    await dialog.getByLabel("Code from your app").fill(totpCode(secret));

    const saved = page.getByRole("dialog", { name: "Save your recovery codes" });
    await expect(saved.getByTestId("recovery-codes").locator("li")).toHaveCount(10);
    const codes = (await saved.getByTestId("recovery-codes").locator("li").allTextContents()).map(
      (code) => code.trim(),
    );
    expect(codes).toHaveLength(10);
    await saved.getByRole("button", { name: "I've saved them" }).click();
    await expect(section.getByTestId("two-factor-status")).toContainText("On.");

    // A password alone is no longer enough.
    await logOut(page);
    await logIn(page, email);
    await expect(page.getByRole("heading", { name: "Two-step sign-in" })).toBeVisible();
    await page.getByLabel("Authenticator code").fill("000000");
    await expect(page.getByRole("alert").filter({ hasText: "didn't work" })).toBeVisible();
    // The next window's code: the one used to turn it on can't be used again.
    await page.getByLabel("Authenticator code").fill(totpCode(secret, 1));
    await expect(page).toHaveURL(/\/chat$/);

    // Lost phone: a recovery code works, once.
    await logOut(page);
    await logIn(page, email);
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill(codes[0]!);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/chat$/);

    await logOut(page);
    await logIn(page, email);
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill(codes[0]!);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "didn't work" })).toBeVisible();
  });

  test("lists signed-in devices and signs one out", async ({ page, browser }) => {
    const { email } = await signUp(page);

    const other = await browser.newContext({
      userAgent: "Mozilla/5.0 (iPhone) Mobile Safari/604.1",
    });
    const phone = await other.newPage();
    await phone.goto("/login");
    await logIn(phone, email);
    await expect(phone).toHaveURL(/\/chat$/);

    await page.goto("/settings");
    const devices = page.getByRole("list", { name: "Signed-in devices" });
    await expect(devices.getByRole("listitem")).toHaveCount(2);
    await expect(devices).toContainText("This device");
    await devices.getByRole("button", { name: "Sign out Safari on iOS" }).click();
    await expect(devices.getByRole("listitem")).toHaveCount(1);

    // The phone's session is over: its next refresh fails and it's sent to log in.
    await phone.reload();
    await expect(phone).toHaveURL(/\/login/);
    await other.close();
  });
});
