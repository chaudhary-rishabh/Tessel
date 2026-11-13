import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

async function sendMessage(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.describe("artifacts", () => {
  test("opens a generated page beside the chat, runs it sandboxed, and keeps its versions", async ({
    page,
  }) => {
    await signUp(page);
    // The mock gateway writes a page for MOCK_ARTIFACT, and a second version for MOCK_ARTIFACT_V2.
    await sendMessage(page, "Make a greeting page MOCK_ARTIFACT");

    const panel = page.getByRole("region", { name: /Greeting page/ });
    await expect(panel).toBeVisible();
    const frame = page.frameLocator('iframe[title="Greeting page"]');
    await expect(frame.getByRole("heading", { name: "Hello from the artifact" })).toBeVisible();
    // Its script ran, inside a frame that can't reach the app.
    await expect(frame.locator("body")).toHaveAttribute("data-ran", "yes");
    await expect(page.locator('iframe[title="Greeting page"]')).toHaveAttribute(
      "sandbox",
      /^(?!.*allow-same-origin)/,
    );

    // On a phone the panel covers the chat; close it to reply.
    if (test.info().project.name === "mobile") {
      await panel.getByRole("button", { name: "Close artifact" }).click();
    }
    await sendMessage(page, "Make it say hello again MOCK_ARTIFACT_V2");
    await expect(frame.getByRole("heading", { name: "Hello again, version two" })).toBeVisible();
    await expect(panel.getByText("Version 2 of 2")).toBeVisible();

    await panel.getByRole("button", { name: "Previous version" }).click();
    await expect(frame.getByRole("heading", { name: "Hello from the artifact" })).toBeVisible();
    await panel.getByRole("tab", { name: "Code" }).click();
    await expect(
      panel.getByText("<h1>Hello from the artifact</h1>", { exact: false }),
    ).toBeVisible();

    const download = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Download" }).click();
    expect((await download).suggestedFilename()).toBe("greeting.html");

    // Closing hides the panel; each reply's card opens its own version again.
    await panel.getByRole("button", { name: "Close artifact" }).click();
    await expect(panel).toBeHidden();
    const cards = page.getByRole("button", { name: /Greeting page/ });
    await expect(cards).toHaveCount(2);
    await cards.last().click();
    await expect(frame.getByRole("heading", { name: "Hello again, version two" })).toBeVisible();
  });

  test("runs an interactive React component", async ({ page }) => {
    await signUp(page);
    await sendMessage(page, "Build a counter MOCK_ARTIFACT_REACT");
    const frame = page.frameLocator('iframe[title="Counter"]');
    // Compiled in the frame, with React from a CDN; give it time to load.
    const button = frame.getByRole("button", { name: "Clicked 0 times" });
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();
    await expect(frame.getByRole("button", { name: "Clicked 1 times" })).toBeVisible();
  });
});
