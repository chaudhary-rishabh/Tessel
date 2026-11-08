import { sparseVector } from "@tessel/ai";
import { describe, expect, it } from "vitest";
import { memoryEpisodeIndex } from "./episodes";
import { memoryPrompt } from "./model";

describe("memory prompt", () => {
  it("lists memories and the summary, or nothing", () => {
    expect(memoryPrompt({ memories: [] })).toBe("");
    const prompt = memoryPrompt({ memories: ["Leads payments."], summary: "Planned the launch." });
    expect(prompt).toContain("<memories>\n- Leads payments.\n</memories>");
    expect(prompt).toContain("<summary>\nPlanned the launch.\n</summary>");
  });
});

describe("episode index", () => {
  it("only finds a user's own chats in the workspace, skipping the current one", async () => {
    const index = memoryEpisodeIndex();
    const episode = (thread: string, user: string, workspace: string, text: string) => ({
      payload: {
        workspace_id: workspace,
        user_id: user,
        thread_id: thread,
        title: text,
        summary: text,
        updated_at: new Date().toISOString(),
      },
      dense: [0.1, 0.2],
      sparse: sparseVector(text),
    });
    await index.upsert(episode("t1", "u1", "w1", "llama budget"));
    await index.upsert(episode("t2", "u2", "w1", "llama budget"));
    await index.upsert(episode("t3", "u1", "w2", "llama budget"));
    await index.upsert(episode("t4", "u1", "w1", "llama plans"));
    const search = (excludeThreadId?: string) =>
      index.search({
        workspaceId: "w1",
        userId: "u1",
        dense: [0.1, 0.2],
        sparse: sparseVector("llama budget"),
        limit: 5,
        ...(excludeThreadId ? { excludeThreadId } : {}),
      });
    expect((await search()).map((hit) => hit.payload.thread_id)).toEqual(["t1", "t4"]);
    expect((await search("t1")).map((hit) => hit.payload.thread_id)).toEqual(["t4"]);
    await index.removeAll("w1", "u1");
    expect(await search()).toEqual([]);
  });
});
