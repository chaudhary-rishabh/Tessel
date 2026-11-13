import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

const tools = (...calls: { name: string; args: Record<string, unknown> }[]) =>
  `MOCK_TOOLS ${JSON.stringify(calls)}`;

/** Videos are a paid feature: upgrade through the mock checkout first. */
async function upgrade(page: Page) {
  await page.goto("/settings#plan");
  const plan = page.getByRole("region", { name: "Plan and usage" });
  await plan.getByRole("button", { name: "Upgrade to Pro with a card" }).click();
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(plan.getByTestId("current-plan")).toHaveText("Pro plan");
}

test.describe("videos", () => {
  test("makes a video in the background after the user agrees, and plays it", async ({ page }) => {
    test.setTimeout(90_000);
    await signUp(page);
    await upgrade(page);
    await page.goto("/chat");

    await page
      .getByRole("textbox", { name: "Message" })
      .fill(
        `Make a clip ${tools({ name: "generate_video", args: { prompt: "Waves rolling in at dusk", duration_seconds: 4 } })}`,
      );
    await page.getByRole("button", { name: "Send message" }).click();

    // A video costs more than a reply, so it asks first.
    const approval = page.getByRole("region", { name: "Allow Tessel to make a video?" });
    await expect(
      approval.getByText("Make a 4-second video: Waves rolling in at dusk"),
    ).toBeVisible();
    await approval.getByRole("button", { name: "Allow" }).click();

    // While it's made, the reply shows its progress; then it plays.
    await expect(page.getByRole("progressbar", { name: "Video progress" })).toBeVisible();
    const video = page.locator('video[aria-label="Waves rolling in at dusk"]');
    await expect(video).toBeVisible({ timeout: 45_000 });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThan(0);
    await expect(page.getByRole("progressbar", { name: "Video progress" })).toHaveCount(0);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download video" }).click();
    expect((await download).suggestedFilename()).toMatch(/^tessel-video-[0-9a-f]{8}\.mp4$/);

    // It's in the gallery's videos.
    await page.goto("/gallery");
    await page.getByRole("tab", { name: "Videos" }).click();
    await expect(page.locator('video[aria-label="Waves rolling in at dusk"]')).toBeVisible();
  });

  test("tells a free user that videos need a paid plan", async ({ page }) => {
    await signUp(page);
    await page.goto("/gallery");
    await page.getByRole("tab", { name: "Videos" }).click();
    await page.getByRole("textbox", { name: "Describe a video" }).fill("A paper boat");
    await page.getByRole("button", { name: "Make video" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "needs a paid plan" })).toBeVisible();
  });
});
