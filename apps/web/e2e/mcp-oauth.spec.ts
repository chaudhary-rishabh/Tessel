import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { expect, test, type Page } from "@playwright/test";
import { logOut, PASSWORD, signUp } from "./helpers";

const MCP_URL = "http://localhost:4100/mcp";
const REDIRECT_URI = "http://127.0.0.1:33418/callback";

/** An outside MCP client (like Claude or Cursor), driven by the MCP SDK's own OAuth support. */
function mcpClient(name: string) {
  const state: {
    info?: OAuthClientInformationMixed;
    tokens?: OAuthTokens;
    verifier?: string;
    authorizationUrl?: URL;
  } = {};
  const provider: OAuthClientProvider = {
    redirectUrl: REDIRECT_URI,
    clientMetadata: {
      client_name: name,
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    clientInformation: () => state.info,
    saveClientInformation: (info) => {
      state.info = info;
    },
    tokens: () => state.tokens,
    saveTokens: (tokens) => {
      state.tokens = tokens;
    },
    redirectToAuthorization: (url) => {
      state.authorizationUrl = url;
    },
    saveCodeVerifier: (verifier) => {
      state.verifier = verifier;
    },
    codeVerifier: () => state.verifier!,
  };
  return { provider, state };
}

/** The client's own redirect page; it just records the code it was given. */
async function catchRedirect(page: Page) {
  let landed: URL | undefined;
  await page.route(`${REDIRECT_URI}**`, async (route) => {
    landed = new URL(route.request().url());
    await route.fulfill({ contentType: "text/html", body: "<p>You can close this tab.</p>" });
  });
  return () => landed;
}

test.describe("outside MCP clients signing in", () => {
  test("a client signs in through the consent page and can use Tessel's tools", async ({
    page,
  }) => {
    await signUp(page, { name: "Grace Hopper" });
    const { provider, state } = mcpClient("Claude (test)");
    expect(await auth(provider, { serverUrl: MCP_URL })).toBe("REDIRECT");

    const landed = await catchRedirect(page);
    await page.goto(state.authorizationUrl!.toString());
    await expect(page).toHaveURL(/\/oauth\/consent\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: "Allow Claude (test) to use Tessel?" }),
    ).toBeVisible();
    await expect(page.getByLabel("Workspace", { exact: true })).toHaveValue(/.+/);
    await expect(page.getByLabel("Search and read the workspace's documents")).toBeChecked();
    await page.getByLabel("Add notes and text documents to the workspace").uncheck();
    await expect(page.getByText("127.0.0.1:33418")).toBeVisible();
    await page.getByRole("button", { name: "Allow" }).click();

    await expect.poll(() => landed()?.searchParams.get("code")).toBeTruthy();
    expect(landed()!.searchParams.get("state")).toBe(
      state.authorizationUrl!.searchParams.get("state"),
    );
    expect(
      await auth(provider, {
        serverUrl: MCP_URL,
        authorizationCode: landed()!.searchParams.get("code")!,
      }),
    ).toBe("AUTHORIZED");

    const client = new Client({ name: "e2e-oauth-client", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${state.tokens!.access_token}` } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "search_documents",
      "list_documents",
      "read_document",
      "ask_tessel",
    ]);
    await client.close();

    // Settings lists it, and disconnecting it ends its access.
    await page.goto("/settings");
    const apps = page.getByRole("list", { name: "Connected apps" });
    await expect(apps).toContainText("Claude (test)");
    await expect(apps).toContainText("Grace's workspace");
    await apps.getByRole("button", { name: "Disconnect Claude (test)" }).click();
    await expect(page.getByText("None yet.")).toBeVisible();
    const after = new Client({ name: "e2e-oauth-client", version: "1.0.0" });
    await expect(
      after.connect(
        new StreamableHTTPClientTransport(new URL(MCP_URL), {
          requestInit: { headers: { Authorization: `Bearer ${state.tokens!.access_token}` } },
        }),
      ),
    ).rejects.toThrow();
  });

  test("asks a signed-out user to log in first, and the client hears a denial", async ({
    page,
  }) => {
    const { email } = await signUp(page);
    await logOut(page);
    const { provider, state } = mcpClient("Cursor (test)");
    await auth(provider, { serverUrl: MCP_URL });

    const landed = await catchRedirect(page);
    await page.goto(state.authorizationUrl!.toString());
    await expect(page).toHaveURL(/\/login\?next=%2Foauth%2Fconsent%2F/);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Allow Cursor (test) to use Tessel?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Deny" }).click();
    await expect.poll(() => landed()?.searchParams.get("error")).toBe("access_denied");
    expect(landed()!.searchParams.get("code")).toBeNull();
  });
});
