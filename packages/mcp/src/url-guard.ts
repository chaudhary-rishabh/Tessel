import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as pinnedFetch } from "undici";

/** Thrown when a connector URL points somewhere Tessel must not reach. */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/**
 * Networks Tessel never connects to for a user: private, loopback, link-local
 * (including the cloud metadata service), shared, benchmark, multicast, and
 * reserved ranges. BlockList also matches IPv4 addresses written as IPv6
 * (::ffff:169.254.169.254, in any notation). NAT64 and 6to4 addresses can carry
 * any IPv4 address inside them, so those ranges are refused whole.
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv6");
}

/** Whether an IP address is on a network connectors may not reach (anything that isn't an IP counts). */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Resolves a host for a connection and refuses private addresses. Used as the
 * socket's own lookup, so the address checked is the address connected to: a
 * DNS answer can't change between the check and the connection.
 */
export const connectorLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some(({ address }) => isPrivateAddress(address))) {
      return callback(
        new UnsafeUrlError("Connectors can't use private or internal addresses"),
        "",
        0,
      );
    }
    if (options.all)
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

const pinnedAgent = new Agent({ connect: { lookup: connectorLookup } });

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
      // Without private networks, connect through an agent that re-checks the
      // address at connect time, so DNS rebinding can't slip past the check above.
      const response = allowPrivate
        ? await fetch(url, { ...request, redirect: "manual" })
        : ((await pinnedFetch(url, {
            ...(request as object),
            redirect: "manual",
            dispatcher: pinnedAgent,
          })) as unknown as Response);
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
