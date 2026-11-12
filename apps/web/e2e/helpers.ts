import { createHmac, randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "a long enough password";

export function uniqueEmail(): string {
  return `e2e-${randomUUID().slice(0, 8)}@example.com`;
}

const API_URL = "http://localhost:4000";

interface OutboxMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * The newest email the API sent to an address matching `pattern`, read from
 * the development outbox (the API keeps emails in memory outside production).
 */
export async function latestEmail(
  page: Page,
  to: string,
  pattern: RegExp,
): Promise<{ message: OutboxMessage; match: RegExpExecArray }> {
  let found: { message: OutboxMessage; match: RegExpExecArray } | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${API_URL}/dev/outbox?to=${encodeURIComponent(to.toLowerCase())}`,
        );
        const { messages } = (await response.json()) as { messages: OutboxMessage[] };
        for (const message of messages.toReversed()) {
          const match = pattern.exec(message.text);
          if (match) {
            found = { message, match };
            return true;
          }
        }
        return false;
      },
      { message: `an email to ${to} matching ${pattern}` },
    )
    .toBe(true);
  return found!;
}

/** The newest six-digit code texted to a number, from the development outbox. */
export async function latestTextedCode(page: Page, phone: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${API_URL}/dev/outbox?to=${encodeURIComponent(phone)}`,
        );
        const { texts } = (await response.json()) as { texts: { text: string }[] };
        code = /\b(\d{6})\b/.exec(texts.at(-1)?.text ?? "")?.[1];
        return Boolean(code);
      },
      { message: `a text to ${phone}` },
    )
    .toBe(true);
  return code!;
}

/** An address made from a name, so the starting name and workspace match it: "ada.lovelace-1a2b3c4d@…". */
export function emailFor(name: string): string {
  return `${name.toLowerCase().split(/\s+/).join(".")}-${randomUUID().slice(0, 8)}@example.com`;
}

/**
 * Signs up the way a person does: email and password, straight into chat.
 * The personal workspace is named from the email ("Ada's workspace"). With a
 * `name`, it's then set in Settings; with `confirmEmail`, the emailed link is
 * followed too. Ends on the chat page.
 */
export async function signUp(
  page: Page,
  {
    name,
    email = emailFor(name ?? "Ada Lovelace"),
    confirmEmail = false,
  }: { name?: string; email?: string; confirmEmail?: boolean } = {},
) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  if (confirmEmail) await confirmEmailFromLink(page, email);
  if (name) await setName(page, name);
  if (confirmEmail || name) await page.goto("/chat");
  return { name: name ?? email, email };
}

/** Opens the newest "confirm your email" link, signed in, as a person would. */
export async function confirmEmailFromLink(page: Page, email: string) {
  const { match } = await latestEmail(page, email, /(\/verify-email\?token=[\w-]+)/);
  await page.goto(match[1]!);
  await expect(page.getByRole("heading", { name: "Your email is confirmed" })).toBeVisible();
}

/** Changes the signed-in person's name in Settings. */
export async function setName(page: Page, name: string) {
  await page.goto("/settings");
  const profile = page.getByRole("region", { name: "Profile" });
  await profile.getByLabel("Your name").fill(name);
  await profile.getByRole("button", { name: "Update name" }).click();
  await expect(profile.getByText("Name saved.")).toBeVisible();
}

/** Opens the navigation: always visible on desktop, a drawer on phones. */
export async function openNavigation(page: Page) {
  const menuButton = page.getByRole("button", { name: "Open navigation" });
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }
}

export async function logOut(page: Page) {
  await openNavigation(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** An authenticator code (RFC 6238), `stepsAhead` 30-second windows from now. */
export function totpCode(secret: string, stepsAhead = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepsAhead));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
