import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beginOAuth, completeOAuth, connectToServer, ConnectorAuthError } from "./client";
import type { ConnectionCredentials } from "./credentials";
import { createSecretBox } from "./crypto";
import { startMockMcpServer, type MockMcpServer } from "./testing";
import { connectorTools, toolName, toolRisk } from "./tools";
import { fetch as undiciFetch, Agent } from "undici";
import { assertSafeUrl, connectorLookup, isPrivateAddress, UnsafeUrlError } from "./url-guard";

const REDIRECT = "http://localhost:4000/connectors/oauth/callback";
const run = {
  context: { workspaceId: "w", userId: "u", feature: "chat" as const },
  signal: new AbortController().signal,
};

describe("secret box", () => {
  it("round-trips values and rejects tampering", () => {
    const box = createSecretBox(randomBytes(32).toString("base64"));
    const sealed = box.seal({ type: "token", token: "abc" });
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain("abc");
    expect(box.open(sealed)).toEqual({ type: "token", token: "abc" });
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => box.open(parts.join(":"))).toThrow();
    expect(() => createSecretBox("short")).toThrow(/32 bytes/);
  });
});

describe("URL guard", () => {
  it("checks the address again when connecting, as the socket's lookup", async () => {
    const lookup = (host: string, all: boolean) =>
      new Promise<unknown>((resolve, reject) =>
        connectorLookup(host, { all }, (error, address, family) =>
          error ? reject(error) : resolve(all ? address : { address, family }),
        ),
      );
    await expect(lookup("93.184.215.14", false)).resolves.toEqual({
      address: "93.184.215.14",
      family: 4,
    });
    await expect(lookup("93.184.215.14", true)).resolves.toEqual([
      { address: "93.184.215.14", family: 4 },
    ]);
    await expect(lookup("127.0.0.1", false)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(lookup("localhost", true)).rejects.toBeInstanceOf(UnsafeUrlError);
    // Through a real connection attempt, too.
    const dispatcher = new Agent({ connect: { lookup: connectorLookup } });
    const refused = await undiciFetch("http://localhost:4999/", { dispatcher }).catch(
      (error: Error & { cause?: unknown }) => error.cause,
    );
    expect(refused).toBeInstanceOf(UnsafeUrlError);
  });

  it("classifies addresses in every notation", () => {
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:a9fe:a9fe")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("93.184.215.14")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
    expect(isPrivateAddress("not an address")).toBe(true);
  });

  it("allows public https URLs and blocks internal ones", async () => {
    await expect(assertSafeUrl("https://93.184.215.14/mcp")).resolves.toBeInstanceOf(URL);
    for (const url of [
      "http://example.com/mcp",
      "https://127.0.0.1/mcp",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/mcp",
      "https://[::1]/mcp",
      // IPv4 written as IPv6, in both notations, and in other IPv4 spellings.
      "https://[::ffff:169.254.169.254]/latest/meta-data",
      "https://[::ffff:ac12:5]:6333/",
      "https://0x7f.1/mcp",
      "https://2130706433/mcp",
      // NAT64 and 6to4 can carry any IPv4 address.
      "https://[64:ff9b::a9fe:a9fe]/",
      "https://[2002:a9fe:a9fe::]/",
      "https://[fd00::1]/mcp",
      "https://[fe80::1]/mcp",
      "https://user:pass@example.com/mcp",
      "not a url",
    ]) {
      await expect(assertSafeUrl(url), url).rejects.toBeInstanceOf(UnsafeUrlError);
    }
    await expect(
      assertSafeUrl("http://127.0.0.1:4400/mcp", { allowPrivate: true }),
    ).resolves.toBeInstanceOf(URL);
  });
});

describe("tool adapter", () => {
  it("names tools safely and asks before anything not marked read-only", () => {
    expect(toolName("GitHub", "search-issues")).toBe("github_search_issues");
    expect(toolName("9 lives", "x".repeat(80))).toHaveLength(64);
    const base = { name: "t", inputSchema: { type: "object" } };
    expect(toolRisk({ ...base, annotations: { readOnlyHint: true } })).toBe("read");
    expect(toolRisk({ ...base, annotations: { destructiveHint: false } })).toBe("write");
    expect(toolRisk(base)).toBe("destructive");
    expect(toolRisk(base, "allow")).toBe("read");
    expect(toolRisk({ ...base, annotations: { readOnlyHint: true } }, "ask")).toBe("write");
    expect(toolRisk(base, "off")).toBeNull();
  });
});

describe("connecting to MCP servers", () => {
  let tokenServer: MockMcpServer;
  let oauthServer: MockMcpServer;
  beforeAll(async () => {
    tokenServer = await startMockMcpServer({ auth: "token", token: "secret" });
    oauthServer = await startMockMcpServer({ auth: "oauth" });
  });
  afterAll(async () => {
    await tokenServer.close();
    await oauthServer.close();
  });

  const endpoint = (server: MockMcpServer, credentials: ConnectionCredentials) => ({
    serverUrl: server.url,
    credentials,
    redirectUrl: REDIRECT,
    allowPrivate: true,
  });

  it("lists and calls tools with a bearer token", async () => {
    const client = await connectToServer(endpoint(tokenServer, { type: "token", token: "secret" }));
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "search_issues",
      "create_issue",
      "delete_repository",
    ]);
    expect(tools[0]!.annotations?.readOnlyHint).toBe(true);
    expect(await client.callTool("search_issues", { query: "safari" })).toEqual({
      text: "#1 Login fails on Safari",
      isError: false,
    });
    await client.close();
  });

  it("reports a bad token as needing sign-in", async () => {
    await expect(
      connectToServer(endpoint(tokenServer, { type: "token", token: "wrong" })),
    ).rejects.toBeInstanceOf(ConnectorAuthError);
  });

  it("refuses private addresses unless allowed", async () => {
    await expect(
      connectToServer({
        ...endpoint(tokenServer, { type: "token", token: "secret" }),
        allowPrivate: false,
      }),
    ).rejects.toThrow(/https|private/);
  });

  it("signs in with OAuth (discovery, registration, PKCE) and refreshes expired tokens", async () => {
    let saved: ConnectionCredentials = { type: "oauth" };
    const url = await beginOAuth({
      serverUrl: oauthServer.url,
      redirectUrl: REDIRECT,
      state: "state-123",
      allowPrivate: true,
      onCredentials: (next) => {
        saved = next;
      },
    });
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(saved).toMatchObject({
      type: "oauth",
      client: { client_id: expect.any(String) },
      codeVerifier: expect.any(String),
    });

    // The "browser" follows the authorization URL; the mock approves at once.
    const approval = await fetch(url, { redirect: "manual" });
    const callback = new URL(approval.headers.get("location")!);
    expect(callback.origin + callback.pathname).toBe(REDIRECT);

    const credentials = await completeOAuth({
      ...endpoint(oauthServer, saved),
      code: callback.searchParams.get("code")!,
    });
    expect(credentials).toMatchObject({
      type: "oauth",
      tokens: { access_token: expect.any(String) },
    });

    let latest = credentials;
    const client = await connectToServer({
      ...endpoint(oauthServer, credentials),
      onCredentials: (next) => {
        latest = next;
      },
    });
    expect((await client.listTools()).length).toBe(3);
    await client.close();

    oauthServer.expireTokens();
    const again = await connectToServer({
      ...endpoint(oauthServer, credentials),
      onCredentials: (next) => {
        latest = next;
      },
    });
    expect((await again.callTool("create_issue", { title: "From Tessel" })).text).toBe(
      "Created issue #3: From Tessel",
    );
    await again.close();
    expect(latest.type === "oauth" && latest.tokens?.access_token).not.toBe(
      credentials.type === "oauth" && credentials.tokens?.access_token,
    );
  });

  it("turns remote tools into agent tools with approval rules", async () => {
    let opened = 0;
    const client = await connectToServer(endpoint(tokenServer, { type: "token", token: "secret" }));
    const tools = connectorTools({
      name: "GitHub",
      prefix: "github",
      tools: await client.listTools(),
      policies: { delete_repository: "off" },
      client: async () => {
        opened += 1;
        return client;
      },
    });
    expect(tools.map((tool) => [tool.name, tool.risk])).toEqual([
      ["github_search_issues", "read"],
      ["github_create_issue", "write"],
    ]);
    const create = tools[1]!;
    expect(create.title).toBe("GitHub: Create issue");
    expect(create.parameters).toMatchObject({
      type: "object",
      properties: { title: { type: "string" } },
    });
    expect(await create.describeCall?.({ title: "Fix login" })).toBe(
      'GitHub: Create issue with title "Fix login"',
    );
    const output = await create.run({ title: "Fix login" }, run);
    expect(output.content).toMatch(/^Created issue #\d+: Fix login$/);
    expect(opened).toBe(1);
    await client.close();
  });

  it("reports errors from the server as tool errors", async () => {
    const client = await connectToServer(endpoint(tokenServer, { type: "token", token: "secret" }));
    const [, , remove] = connectorTools({
      name: "GitHub",
      prefix: "github",
      tools: await client.listTools(),
      policies: {},
      client: async () => client,
    });
    expect(remove!.risk).toBe("destructive");
    await expect(remove!.run({ confirm: true }, run)).rejects.toThrow("Not allowed in this mock");
    await client.close();
  });
});
