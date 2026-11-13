import { create } from "zustand";

interface SkillPickState {
  /** The skill the next message follows, picked with "/" in the composer. */
  skill: { name: string; title: string } | null;
  set(skill: { name: string; title: string }): void;
  clear(): void;
}

export const useSkillPick = create<SkillPickState>((set) => ({
  skill: null,
  set: (skill) => set({ skill }),
  clear: () => set({ skill: null }),
}));
