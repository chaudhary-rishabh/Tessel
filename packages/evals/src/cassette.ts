import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

/**
 * A recording proxy for the AI gateway. In "record" mode it forwards each
 * request to the real gateway and saves the response under a hash of the
 * request; in "replay" mode it answers from those files, so suites that need
 * real model behaviour run in CI for free and give the same result every time.
 *
 * A request the cassette doesn't have fails with 412 and names the missing
 * file, so a prompt change shows up as "re-record", not as a silent
 * difference. Streams are saved whole and replayed in one piece.
 */
export interface CassetteProxy {
  /** Base URL including /v1, to use as the gateway URL. */
  url: string;
  /** Requests answered from or written to the cassette. */
  readonly hits: number;
  /** Requests the cassette didn't have (replay mode). */
  readonly misses: string[];
  close(): Promise<void>;
}

interface Recording {
  status: number;
  contentType: string;
  /** Base64, so streamed and binary bodies survive JSON. */
  body: string;
}

/** Fields that vary between runs without changing what the model is asked. */
const VOLATILE_FIELDS = new Set(["user", "stream_options", "metadata", "store"]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !VOLATILE_FIELDS.has(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/** The cassette key for a request: its path and its body with volatile fields removed. */
export function requestKey(path: string, body: Buffer): string {
  let normalized: unknown = body.toString("utf8");
  try {
    normalized = canonical(JSON.parse(body.toString("utf8")));
  } catch {
    // Not JSON (audio uploads): hash the bytes as they are.
  }
  return createHash("sha256")
    .update(path)
    .update("\n")
    .update(typeof normalized === "string" ? normalized : JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 24);
}

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

export async function startCassetteProxy({
  mode,
  directory,
  upstream,
  apiKey,
}: {
  mode: "record" | "replay";
  /** Where recordings live, one JSON file per request. */
  directory: string;
  /** The real gateway (record mode). */
  upstream?: string;
  apiKey?: string;
}): Promise<CassetteProxy> {
  if (mode === "record" && (!upstream || !apiKey)) {
    throw new Error("Recording needs the gateway URL and key");
  }
  await mkdir(directory, { recursive: true });
  let hits = 0;
  const misses: string[] = [];
  const upstreamBase = upstream?.replace(/\/v1\/?$/, "");

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? "/", "http://cassette").pathname;
    const body = await readBody(req);
    const file = join(directory, `${requestKey(path, body)}.json`);

    if (mode === "replay") {
      let recording: Recording;
      try {
        recording = JSON.parse(await readFile(file, "utf8")) as Recording;
      } catch {
        misses.push(file);
        res.writeHead(412, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: `Not in the cassette: ${file}. Re-record with --mode live --record.`,
            },
          }),
        );
        return;
      }
      hits += 1;
      res.writeHead(recording.status, { "content-type": recording.contentType });
      res.end(Buffer.from(recording.body, "base64"));
      return;
    }

    const headers: Record<string, string> = { authorization: `Bearer ${apiKey}` };
    for (const name of ["content-type", "accept", "ai-gateway-protocol-version"]) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const response = await fetch(`${upstreamBase}${req.url ?? path}`, {
      method: req.method ?? "POST",
      headers,
      ...(body.length ? { body } : {}),
    });
    const payload = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "application/json";
    // Failures aren't saved, so a flaky upstream doesn't get baked into the cassette.
    if (response.ok) {
      const recording: Recording = {
        status: response.status,
        contentType,
        body: payload.toString("base64"),
      };
      await writeFile(file, `${JSON.stringify(recording)}\n`);
      hits += 1;
    }
    res.writeHead(response.status, { "content-type": contentType });
    res.end(payload);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(error) } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    get hits() {
      return hits;
    },
    misses,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
