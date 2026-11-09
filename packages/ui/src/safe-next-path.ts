const BASE = "https://tessel.invalid";

/**
 * Where to go after signing in, but only within this app. The path is
 * resolved the way a browser would, which strips tabs and newlines and turns
 * backslashes into slashes, so tricks like `/\t/evil.example` or
 * `/\evil.example` can't send anyone to another site.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/")) return fallback;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // A path like "//evil.example" would be read as another site by the router.
  return path.startsWith("//") ? fallback : path;
}
