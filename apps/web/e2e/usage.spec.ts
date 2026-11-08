import { expect, test } from "@playwright/test";
import { PASSWORD, signUp } from "./helpers";

const API_URL = "http://localhost:4000";

test.describe("usage", () => {
  test("shows today's limits before any usage", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings");
    const usage = page.getByRole("region", { name: "Usage" });
    await expect(usage.getByText("No AI usage yet.", { exact: false })).toBeVisible();
    await expect(usage.getByRole("meter", { name: "You today spend" })).toHaveAttribute(
      "aria-valuemax",
      "5",
    );
    await expect(usage.getByText("$0.00 of $5.00")).toBeVisible();
  });

  test("lists every model call made in the workspace", async ({ page, request }) => {
    const { email } = await signUp(page);
    const login = await request.post(`${API_URL}/auth/login`, {
      data: { email, password: PASSWORD },
    });
    const { accessToken } = (await login.json()) as { accessToken: string };
    const headers = { Authorization: `Bearer ${accessToken}` };
    const workspaces = (await (await request.get(`${API_URL}/workspaces`, { headers })).json()) as {
      workspaces: { id: string }[];
    };
    const completion = await request.post(
      `${API_URL}/workspaces/${workspaces.workspaces[0]!.id}/completions`,
      {
        headers,
        data: { messages: [{ role: "user", content: "Hello" }] },
      },
    );
    expect(completion.status()).toBe(200);

    await page.goto("/settings");
    const usage = page.getByRole("region", { name: "Usage" });
    // The reply and its moderation check.
    await expect(usage.getByText("Model calls").locator("..").getByText("2")).toBeVisible();
    const table = usage.getByRole("table", { name: "Usage by model" });
    await expect(table.getByRole("row", { name: /Claude Sonnet 5/ })).toBeVisible();
    await expect(table.getByRole("row", { name: /GPT-5.4 nano/ })).toBeVisible();
  });
});
