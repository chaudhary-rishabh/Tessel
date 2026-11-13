import { expect, test, type Page } from "@playwright/test";
import { pickModel, signUp } from "./helpers";

function plan(page: Page) {
  return page.getByRole("region", { name: "Plan and usage" });
}

async function openPlan(page: Page) {
  await page.goto("/settings#plan");
  await expect(plan(page).getByTestId("current-plan")).toBeVisible();
}

test.describe("plans and billing", () => {
  test("shows the free plan's limits and the plans to upgrade to", async ({ page }) => {
    await signUp(page);
    await openPlan(page);
    await expect(plan(page).getByTestId("current-plan")).toHaveText("Free plan");
    await expect(plan(page).getByRole("meter", { name: "Five-hour limit used" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    await expect(plan(page).getByRole("meter", { name: "Weekly limit used" })).toBeVisible();
    const plans = plan(page).getByRole("list", { name: "Plans" });
    await expect(plans.getByRole("heading", { name: "Pro" })).toBeVisible();
    await expect(plans.getByRole("heading", { name: "Max" })).toBeVisible();
    // Team is for shared workspaces, not a personal one.
    await expect(plans.getByRole("heading", { name: "Team" })).toHaveCount(0);
    // Free has no extra usage.
    await expect(plan(page).getByRole("heading", { name: "Extra usage" })).toHaveCount(0);
  });

  test("upgrades to Pro with a card, turns on extra usage, and cancels", async ({ page }) => {
    await signUp(page);
    await openPlan(page);
    await plan(page).getByRole("button", { name: "Upgrade to Pro with a card" }).click();

    // The (mock) Stripe checkout page.
    await expect(page.getByRole("heading", { name: "Mock Stripe checkout" })).toBeVisible();
    await page.getByRole("button", { name: "Pay" }).click();

    await expect(page).toHaveURL(/\/settings(#plan)?$/);
    await expect(page.getByText("Payment received. Your plan is updating.")).toBeVisible();
    await expect(plan(page).getByTestId("current-plan")).toHaveText("Pro plan");
    await expect(plan(page).getByText(/^Renews on /)).toBeVisible();

    const extra = plan(page)
      .getByRole("heading", { name: "Extra usage" })
      .locator("..")
      .locator("..");
    await extra.getByLabel("Turn on extra usage").check();
    await extra.getByLabel("Monthly cap in US dollars").fill("15");
    await extra.getByRole("button", { name: "Save extra usage" }).click();
    await expect(page.getByText("Extra usage is on")).toBeVisible();
    await page.reload();
    await expect(plan(page).getByLabel("Turn on extra usage")).toBeChecked();
    await expect(plan(page).getByLabel("Monthly cap in US dollars")).toHaveValue("15");

    await plan(page).getByRole("button", { name: "Cancel plan" }).click();
    await expect(plan(page).getByText(/^Ends on .*you'll move to Free then\.$/)).toBeVisible();
    await plan(page).getByRole("button", { name: "Keep Pro" }).click();
    await expect(plan(page).getByText(/^Renews on /)).toBeVisible();
  });

  test("upgrades to Max with Razorpay", async ({ page }) => {
    await signUp(page);
    await openPlan(page);
    await plan(page)
      .getByRole("button", { name: "Upgrade to Max with UPI or an Indian card" })
      .click();
    await expect(page.getByRole("heading", { name: "Mock Razorpay subscription" })).toBeVisible();
    await page.getByRole("button", { name: "Pay" }).click();
    await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();

    await openPlan(page);
    await expect(plan(page).getByTestId("current-plan")).toHaveText("Max plan");
  });

  test("explains that a Pro model needs a paid plan", async ({ page }) => {
    await signUp(page);
    // "Claude Opus 5", not "Claude Opus 5.5".
    await pickModel(page, "Claude", /^Claude Opus 5(?!\.)/);
    await page.getByRole("textbox", { name: "Message" }).fill("Hello there");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "needs a paid plan" })).toBeVisible();
  });
});
