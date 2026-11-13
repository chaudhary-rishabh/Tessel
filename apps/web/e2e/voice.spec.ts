import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// The agent's offline speech "hears" this after a second of microphone audio,
// and the mock gateway answers by echoing it.
const HEARD = "Hello from the test microphone";

// Voice needs LiveKit and the voice agent (with E2E_VOICE set, the config starts the agent).
test.skip(!process.env.E2E_VOICE, "Voice end-to-end tests need LiveKit (set E2E_VOICE=1)");

test.use({
  permissions: ["microphone"],
  // Chromium's fake microphone plays a tone, and no permission prompt appears.
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test.describe("voice", () => {
  // A conversation happens in real time: the agent joins, hears a second of audio, and answers.
  test.setTimeout(60_000);

  test("talks with Tessel and keeps what was said in the chat", async ({ page }) => {
    await signUp(page);
    await page.getByRole("button", { name: "Start voice conversation" }).click();

    const voice = page.getByRole("dialog", { name: "Voice conversation" });
    await expect(voice).toBeVisible();
    // The agent joins, hears the microphone, and answers aloud with captions.
    await expect(voice.getByText(`Echo: ${HEARD}`)).toBeVisible({ timeout: 30_000 });
    await expect(voice.getByRole("button", { name: "Turn microphone off" })).toBeVisible();

    // Muting turns the microphone off and says so.
    await voice.getByRole("button", { name: "Turn microphone off" }).click();
    await expect(voice.getByRole("button", { name: "Turn microphone on" })).toBeVisible();
    await voice.getByRole("button", { name: "Turn microphone on" }).click();

    await voice.getByRole("button", { name: "End" }).click();
    await expect(voice).toBeHidden();

    // The conversation is a chat now, with both sides marked as spoken.
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
    const messages = page.getByRole("list", { name: "Messages" });
    await expect(messages.getByText(HEARD, { exact: true })).toBeVisible();
    await expect(messages.getByText(`Echo: ${HEARD}`)).toBeVisible();
    await expect(messages.getByText("Spoken")).toHaveCount(2);
  });

  test("continues a typed chat by voice", async ({ page }) => {
    await signUp(page);
    await page.getByRole("textbox", { name: "Message" }).fill("Plan a picnic");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Echo: Plan a picnic")).toBeVisible();
    const chatUrl = page.url();

    await page.getByRole("button", { name: "Start voice conversation" }).click();
    const voice = page.getByRole("dialog", { name: "Voice conversation" });
    await expect(voice.getByText(`Echo: ${HEARD}`)).toBeVisible({ timeout: 30_000 });
    // Escape ends the call, like End.
    await page.keyboard.press("Escape");
    await expect(voice).toBeHidden();

    expect(page.url()).toBe(chatUrl);
    const messages = page.getByRole("list", { name: "Messages" });
    await expect(messages.getByRole("listitem")).toHaveCount(4);
    await expect(messages.getByText("Echo: Plan a picnic")).toBeVisible();
    await expect(messages.getByText(`Echo: ${HEARD}`)).toBeVisible();
  });
});

test.describe("voice settings", () => {
  test("picks the voice Tessel speaks with, and keeps the choice", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings#voice");
    const section = page.getByRole("region", { name: "Voice" });
    await expect(section.getByRole("radio", { name: /Matilda/ })).toBeChecked();
    await section.getByRole("radio", { name: /Brian/ }).check();
    await expect(section.getByRole("radio", { name: /Brian/ })).toBeChecked();

    await page.reload();
    await expect(
      page.getByRole("region", { name: "Voice" }).getByRole("radio", { name: /Brian/ }),
    ).toBeChecked();
    // Without ElevenLabs on this server, there's no own voice to add.
    await expect(page.getByRole("button", { name: "Add your voice" })).toHaveCount(0);
  });
});
