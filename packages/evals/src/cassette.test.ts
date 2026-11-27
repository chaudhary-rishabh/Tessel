import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestKey, startCassetteProxy } from "./cassette";

let gateway: MockGateway;
let directory: string;
beforeAll(async () => {
  gateway = await startMockGateway();
  directory = await mkdtemp(join(tmpdir(), "tessel-cassette-"));
});
afterAll(async () => {
  await gateway.close();
  await rm(directory, { recursive: true, force: true });
});

const completion = (url: string, content: string, extra: Record<string, unknown> = {}) =>
  fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-5.4-nano",
      messages: [{ role: "user", content }],
      ...extra,
    }),
  });

describe("cassette proxy", () => {
  it("keys requests on their content, ignoring volatile fields and key order", () => {
    const a = requestKey(
      "/v1/chat/completions",
      Buffer.from('{"model":"m","messages":[],"user":"u1"}'),
    );
    const b = requestKey(
      "/v1/chat/completions",
      Buffer.from('{"messages":[],"model":"m","user":"u2"}'),
    );
    const c = requestKey("/v1/chat/completions", Buffer.from('{"messages":[],"model":"other"}'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("records upstream responses and replays them without the upstream", async () => {
    const recorder = await startCassetteProxy({
      mode: "record",
      directory,
      upstream: gateway.url,
      apiKey: "secret",
    });
    const recorded = await (await completion(recorder.url, "hello cassette")).json();
    await recorder.close();
    expect(gateway.requests.at(-1)?.headers.authorization).toBe("Bearer secret");
    expect(await readdir(directory)).toHaveLength(1);

    const player = await startCassetteProxy({ mode: "replay", directory });
    const replayed = await (
      await completion(player.url, "hello cassette", { user: "someone-else" })
    ).json();
    expect(replayed).toEqual(recorded);
    expect(player.hits).toBe(1);

    const miss = await completion(player.url, "never recorded");
    expect(miss.status).toBe(412);
    expect(((await miss.json()) as { error: { message: string } }).error.message).toContain(
      "Re-record",
    );
    expect(player.misses).toHaveLength(1);
    await player.close();
  });

  it("doesn't save failed upstream responses", async () => {
    const before = (await readdir(directory)).length;
    const recorder = await startCassetteProxy({
      mode: "record",
      directory,
      upstream: gateway.url,
      apiKey: "k",
    });
    gateway.enqueue({ status: 500 });
    const response = await completion(recorder.url, "this one fails");
    await recorder.close();
    expect(response.status).toBe(500);
    expect(await readdir(directory)).toHaveLength(before);
  });
});
