import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

test.describe("apps", () => {
  test("runs a multi-file app, moves between its pages, and downloads the project", async ({
    page,
  }) => {
    await signUp(page);
    // The mock gateway writes a small React app (several files) for MOCK_APP.
    await composer(page).fill("Build me a counter app MOCK_APP");
    await page.getByRole("button", { name: "Send message" }).click();

    const panel = page.getByRole("region", { name: /Counter app/ });
    await expect(panel).toBeVisible();
    const frame = page.frameLocator('iframe[title="Counter app"]');

    // Its modules import each other and React; they're compiled in the frame.
    const button = frame.getByRole("button", { name: "Count is 0" });
    await expect(button).toBeVisible({ timeout: 30_000 });
    // The imported stylesheet applies.
    await expect(button).toHaveCSS("color", "rgb(31, 111, 100)");
    await button.click();
    await expect(frame.getByRole("button", { name: "Count is 1" })).toBeVisible();

    // A link to another of its pages opens that page.
    await frame.getByRole("link", { name: "About" }).click();
    await expect(frame.getByRole("heading", { name: "About this app" })).toBeVisible();
    await expect(panel.getByRole("combobox", { name: "Page" })).toHaveValue("about.html");
    await panel.getByRole("combobox", { name: "Page" }).selectOption("index.html");
    await expect(frame.getByRole("button", { name: "Count is 0" })).toBeVisible({
      timeout: 30_000,
    });

    // The code shows file by file.
    await panel.getByRole("tab", { name: "Code" }).click();
    const files = panel.getByRole("navigation", { name: "Files" });
    await expect(files.getByRole("button")).toHaveCount(7);
    await files.getByRole("button", { name: "src/App.jsx" }).click();
    await expect(panel.getByText("export default function App()", { exact: false })).toBeVisible();

    const download = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Download" }).click();
    expect((await download).suggestedFilename()).toBe("counter-app.zip");
  });
});
