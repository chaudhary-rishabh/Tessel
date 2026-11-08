import { describe, expect, it } from "vitest";
import {
  builtInSkills,
  loadSkillTool,
  SKILL_NAME_PATTERN,
  skillName,
  skillsPrompt,
} from "./skills";

const run = {
  context: { workspaceId: "w", userId: "u", feature: "chat" as const },
  signal: new AbortController().signal,
};

describe("skills", () => {
  it("makes names from titles", () => {
    expect(skillName("Release notes!")).toBe("release-notes");
    expect(skillName("  Q3 — Board update  ")).toBe("q3-board-update");
    expect(skillName("Café menu")).toBe("cafe-menu");
    expect(skillName("!!!")).toBe("");
    for (const skill of builtInSkills) expect(skill.name).toMatch(SKILL_NAME_PATTERN);
  });

  it("lists skills by name and description only", () => {
    const prompt = skillsPrompt(builtInSkills);
    expect(prompt).toContain("- meeting-notes: Turn rough notes");
    expect(prompt).not.toContain("Action items: a checklist");
    expect(skillsPrompt([])).toBe("");
  });

  it("loads a skill's instructions and explains unknown names", async () => {
    const tool = loadSkillTool(builtInSkills);
    expect(tool.risk).toBe("read");
    const output = await tool.run({ name: "Meeting-Notes" }, run);
    expect(output.summary).toBe("Meeting notes");
    expect(output.content).toMatch(
      /^<skill name="meeting-notes" title="Meeting notes">\nWrite meeting notes/,
    );
    await expect(tool.run({ name: "nope" }, run)).rejects.toThrow(
      /no skill called "nope".*meeting-notes/,
    );
  });
});
