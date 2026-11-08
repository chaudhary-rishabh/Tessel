import { Writable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { REDACTED_PATHS } from "./index";

describe("logger redaction", () => {
  it("hides secrets in log output", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = pino({ redact: { paths: REDACTED_PATHS, censor: "[redacted]" } }, sink);

    logger.info({ user: { email: "a@b.com", password: "hunter2" }, apiKey: "sk-123" }, "login");

    const output = lines.join("");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("sk-123");
    expect(output).toContain("a@b.com");
  });
});
