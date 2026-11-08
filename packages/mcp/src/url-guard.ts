import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Thrown when a connector URL points somewhere Tessel must not reach. */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function isPrivateIPv4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIPv4(address);
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateIPv4(lower.slice(7));
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff")
  );
}

/**
 * Checks a URL before Tessel connects to it on a user's behalf: HTTPS only,
 * and never an address on a private, loopback, or link-local network (which
 * would let a user reach internal services, such as the cloud metadata
 * endpoint). `allowPrivate` is for local development and tests.
 */
export async function assertSafeUrl(
  url: string | URL,
  { allowPrivate = false } = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeUrlError("Enter a full URL, starting with https://");
  }
  if (parsed.username || parsed.password)
    throw new UnsafeUrlError("URLs can't include a username or password");
  if (allowPrivate) {
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new UnsafeUrlError("Use an http or https URL");
    }
    return parsed;
  }
  if (parsed.protocol !== "https:") throw new UnsafeUrlError("Connectors must use https");
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new UnsafeUrlError(`Can't find ${host}`);
      });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new UnsafeUrlError("Connectors can't use private or internal addresses");
  }
  return parsed;
}

const MAX_REDIRECTS = 3;

/**
 * fetch for connector traffic: every request, including each redirect hop,
 * passes the URL check, so a server can't bounce Tessel to an internal address.
 */
export function guardedFetch({ allowPrivate = false } = {}): typeof fetch {
  return async (input, init) => {
    let url = input instanceof Request ? input.url : String(input);
    let request = init;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertSafeUrl(url, { allowPrivate });
      const response = await fetch(url, { ...request, redirect: "manual" });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) return response;
      url = new URL(location, url).toString();
      // A 303, or a 301/302 after a POST, continues as a GET without a body.
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && request?.method === "POST")
      ) {
        const { body: _body, ...rest } = request ?? {};
        request = { ...rest, method: "GET" };
      }
    }
    throw new UnsafeUrlError("Too many redirects");
  };
}
