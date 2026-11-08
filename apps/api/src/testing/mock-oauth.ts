import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for Google's and GitHub's sign-in, for development and tests.
 * The sign-in page asks for an email and name instead of a password, then
 * behaves like the real providers: authorization code with PKCE, token
 * exchange, and the profile endpoints Tessel reads.
 */
export interface MockOAuthProvider {
  url: string;
  close(): Promise<void>;
}

interface Grant {
  provider: "google" | "github";
  email: string;
  name: string;
  verified: boolean;
  codeChallenge: string;
  redirectUri: string;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

/** A stable account ID per provider and email, like a real provider's. */
const accountId = (provider: string, email: string) =>
  createHash("sha256").update(`${provider}:${email}`).digest("hex").slice(0, 12);

async function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

function signInPage(provider: "google" | "github", query: URLSearchParams): string {
  const label = provider === "google" ? "Google" : "GitHub";
  const hidden = ["redirect_uri", "state", "code_challenge"]
    .map(
      (name) => `<input type="hidden" name="${name}" value="${escapeHtml(query.get(name) ?? "")}">`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in with ${label} (mock)</title>
<style>body{font:16px system-ui;max-width:24rem;margin:3rem auto;padding:0 1rem}label{display:block;margin:1rem 0 .25rem}input[type=email],input[type=text]{width:100%;padding:.5rem;font:inherit}button{margin-top:1.5rem;padding:.6rem 1rem;font:inherit}</style>
</head><body><h1>Sign in with ${label}</h1><p>Mock provider for development and tests.</p>
<form method="get" action="/${provider}/approve">${hidden}
<label for="email">Email</label><input id="email" name="email" type="email" required>
<label for="name">Name</label><input id="name" name="name" type="text">
<label><input name="verified" type="checkbox" value="true" checked> Email verified</label>
<button type="submit" name="decision" value="allow">Continue</button>
<button type="submit" name="decision" value="deny">Cancel</button>
</form></body></html>`;
}

export async function startMockOAuthProvider({
  port = 0,
  host = "127.0.0.1",
}: { port?: number; host?: string } = {}): Promise<MockOAuthProvider> {
  const codes = new Map<string, Grant>();
  const tokens = new Map<string, Grant>();

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const [, provider, ...rest] = url.pathname.split("/");
    const path = rest.join("/");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/health") return json(200, { status: "ok" });
    if (provider !== "google" && provider !== "github") return json(404, { error: "not_found" });

    if (req.method === "GET" && path === "authorize") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(signInPage(provider, url.searchParams));
      return;
    }

    if (req.method === "GET" && path === "approve") {
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
      if (url.searchParams.get("decision") === "deny") {
        redirect.searchParams.set("error", "access_denied");
      } else {
        const code = randomBytes(16).toString("hex");
        const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
        codes.set(code, {
          provider,
          email,
          name: url.searchParams.get("name")?.trim() || email.split("@")[0]!,
          verified: url.searchParams.get("verified") === "true",
          codeChallenge: url.searchParams.get("code_challenge") ?? "",
          redirectUri: url.searchParams.get("redirect_uri") ?? "",
        });
        redirect.searchParams.set("code", code);
      }
      res.writeHead(302, { Location: redirect.toString() });
      res.end();
      return;
    }

    if (req.method === "POST" && path === "token") {
      const body = await readBody(req);
      const grant = codes.get(body.get("code") ?? "");
      codes.delete(body.get("code") ?? "");
      const verifier = body.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (
        !grant ||
        grant.provider !== provider ||
        grant.redirectUri !== body.get("redirect_uri") ||
        grant.codeChallenge !== challenge
      ) {
        return json(provider === "github" ? 200 : 400, { error: "invalid_grant" });
      }
      const accessToken = randomBytes(16).toString("hex");
      tokens.set(accessToken, grant);
      return json(200, { access_token: accessToken, token_type: "bearer" });
    }

    const grant = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
    if (!grant || grant.provider !== provider) return json(401, { error: "invalid_token" });

    if (provider === "google" && path === "userinfo") {
      return json(200, {
        sub: accountId("google", grant.email),
        email: grant.email,
        email_verified: grant.verified,
        name: grant.name,
      });
    }
    if (provider === "github" && path === "api/user") {
      return json(200, {
        id: Number.parseInt(accountId("github", grant.email).slice(0, 8), 16),
        login: grant.email.split("@")[0],
        name: grant.name,
      });
    }
    if (provider === "github" && path === "api/user/emails") {
      return json(200, [{ email: grant.email, primary: true, verified: grant.verified }]);
    }
    return json(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://${host}:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
