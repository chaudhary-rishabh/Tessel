import { expect, test } from "@playwright/test";
import { latestEmail, logOut, openNavigation, PASSWORD, signUp, uniqueEmail } from "./helpers";

test.describe("authentication", () => {
  test("signs up and lands in the personal workspace", async ({ page }) => {
    await signUp(page, { name: "Grace Hopper" });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Grace");
    await openNavigation(page);
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Grace's workspace",
    );
  });

  test("keeps the session after a page reload", async ({ page }) => {
    await signUp(page, { name: "Katherine Johnson" });
    await page.reload();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Katherine");
  });

  test("logs out and back in", async ({ page }) => {
    const { email } = await signUp(page);
    await logOut(page);

    // The session is really gone: protected pages send you back to log in.
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    // After logging in, you return to the page you asked for.
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("shows a clear error for wrong credentials", async ({ page }) => {
    const { email } = await signUp(page);
    await logOut(page);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Email or password is incorrect" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("validates the signup form before sending it", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Name is required")).toBeVisible();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByText("Password must be at least 10 characters")).toBeVisible();
  });

  test("emails the owner, not the visitor, when an email is already registered", async ({
    page,
    browser,
  }) => {
    const { email } = await signUp(page);

    const other = await browser.newPage();
    await other.goto("/signup");
    await other.getByLabel("Name").fill("Someone Else");
    await other.getByLabel("Email").fill(email);
    await other.getByLabel("Password").fill(PASSWORD);
    await other.getByRole("button", { name: "Continue" }).click();
    // The page looks the same as for a new address, so it can't be used to find accounts.
    await expect(other.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const { message } = await latestEmail(other, email, /already have one/);
    expect(message.subject).toBe("You already have a Tessel account");
    await other.close();
  });

  test("rejects a wrong signup code, then accepts a new one", async ({ page }) => {
    const email = uniqueEmail();
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Mary Jackson");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    const first = (await latestEmail(page, email, /^(\d{6})$/m)).match[1]!;

    await page.getByLabel("Code from your email").fill(first === "000000" ? "111111" : "000000");
    await expect(page.getByRole("alert").filter({ hasText: "wrong or has expired" })).toBeVisible();

    await page.getByRole("button", { name: "Send a new code" }).click();
    await expect(page.getByText("We sent a new code.")).toBeVisible();
    await expect
      .poll(async () => (await latestEmail(page, email, /^(\d{6})$/m)).message.subject)
      .not.toBe(`${first} is your Tessel code`);
    const second = (await latestEmail(page, email, /^(\d{6})$/m)).match[1]!;
    await page.getByLabel("Code from your email").fill(second);
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("sends visitors who aren't logged in to the login page", async ({ page }) => {
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login\?next=%2Fchat$/);
  });

  test("never redirects to another site after login", async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, { email });
    await logOut(page);

    await page.goto("/login?next=https://evil.example");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/localhost:3000\/chat$/);
  });
});
