import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test.describe("appearance", () => {
  test("switches between light, dark, and the device's theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signUp(page);
    await page.goto("/settings#appearance");
    const html = page.locator("html");
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await background();

    await page.getByRole("radio", { name: "Dark" }).check({ force: true });
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await background()).not.toBe(light);

    // Kept after a reload, before the app has loaded.
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();

    await page.getByRole("radio", { name: "Match my device" }).check({ force: true });
    await expect(html).not.toHaveAttribute("data-theme", /.+/);
    expect(await background()).toBe(light);
  });
});
