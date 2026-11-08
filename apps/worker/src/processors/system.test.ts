import { createLogger } from "@tessel/logger";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";
import { processSystemJob } from "./system";

const logger = createLogger("worker-test", { level: "silent", pretty: false });

describe("processSystemJob", () => {
  it("processes a valid ping", async () => {
    await expect(
      processSystemJob(
        { id: "1", name: "ping", data: { requestedAt: "2026-11-08T10:00:00.000Z", source: "api" } },
        logger,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("fails an unknown job without retrying", async () => {
    await expect(processSystemJob({ name: "reindex", data: {} }, logger)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it("fails an invalid payload without retrying", async () => {
    await expect(
      processSystemJob({ name: "ping", data: { source: "api" } }, logger),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
