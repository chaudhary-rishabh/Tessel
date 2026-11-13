import { expect, test, type Locator, type Page } from "@playwright/test";
import { signUp } from "./helpers";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const tools = (...calls: { name: string; args: Record<string, unknown> }[]) =>
  `MOCK_TOOLS ${JSON.stringify(calls)}`;

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

/** The image inside has loaded and has pixels. */
async function expectLoaded(image: Locator) {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
}

test.describe("images", () => {
  test("makes an image in chat, edits it, and keeps both in the gallery", async ({ page }) => {
    await signUp(page);
    // The mock gateway calls the tools named in MOCK_TOOLS and draws a solid PNG.
    await send(
      page,
      `Draw a fox ${tools({ name: "generate_image", args: { prompt: "A teal fox in the snow", aspect_ratio: "16:9" } })}`,
    );
    const fox = page.getByRole("button", { name: "Open image: A teal fox in the snow" });
    await expectLoaded(fox.getByRole("img"));
    // It has the shape asked for.
    const box = (await fox.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(16 / 9, 1);

    // Full screen, with its prompt; "Edit in chat" points the composer at it.
    await fox.click();
    const viewer = page.getByRole("dialog", { name: "Image" });
    await expect(viewer.getByText("A teal fox in the snow")).toBeVisible();
    await viewer.getByRole("button", { name: "Edit in chat" }).click();
    await expect(viewer).toBeHidden();
    await expect(page.getByText("Editing this image. Describe the change.")).toBeVisible();
    await send(
      page,
      `Make it night ${tools({ name: "edit_image", args: { prompt: "Make it night" } })}`,
    );
    await expectLoaded(
      page.getByRole("button", { name: "Open image: Make it night" }).getByRole("img"),
    );
    // The message shows which image it was about, not the reference itself.
    await expect(page.getByRole("img", { name: "The image to edit" }).first()).toBeVisible();
    await expect(page.getByText(/\[image:/)).toHaveCount(0);

    // Both are in the gallery, newest first.
    await page.goto("/gallery");
    await expect(page.getByRole("heading", { name: "Gallery" })).toBeVisible();
    const tiles = page.getByRole("button", { name: /^Open image:/ });
    await expect(tiles).toHaveCount(2);
    await expect(tiles.first()).toHaveAccessibleName("Open image: Make it night");
  });

  test("creates, edits, and deletes images in the gallery", async ({ page }) => {
    await signUp(page);
    await page.goto("/gallery");
    await expect(page.getByText("No images yet.", { exact: false })).toBeVisible();

    await page.getByRole("textbox", { name: "Describe an image" }).fill("A blue whale at dawn");
    await page.getByRole("combobox", { name: "Shape" }).selectOption("9:16");
    await page.getByRole("button", { name: "Create" }).click();

    // The new image opens straight away.
    const viewer = page.getByRole("dialog", { name: "Image" });
    await expect(viewer.getByText("A blue whale at dawn")).toBeVisible();
    await expectLoaded(viewer.getByRole("img", { name: "A blue whale at dawn" }));

    await viewer.getByRole("textbox", { name: "Change to make" }).fill("Make it purple");
    await viewer.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(viewer.getByText("Make it purple")).toBeVisible();
    await expectLoaded(viewer.getByRole("img", { name: "Make it purple" }));

    // Downloads the full image.
    const download = page.waitForEvent("download");
    await viewer.getByRole("button", { name: "Download" }).click();
    expect((await download).suggestedFilename()).toMatch(/^tessel-image-[0-9a-f]{8}\.png$/);

    await viewer.getByRole("button", { name: "Delete" }).click();
    await viewer.getByRole("button", { name: "Delete for good" }).click();
    await expect(viewer).toBeHidden();
    const tiles = page.getByRole("button", { name: /^Open image:/ });
    await expect(tiles).toHaveCount(1);
    await expect(tiles.first()).toHaveAccessibleName("Open image: A blue whale at dawn");
  });
});
