import { create } from "zustand";

interface ArtifactPanelState {
  /** The chat the panel belongs to, so it closes when the chat changes. */
  threadKey: string | null;
  /** The artifact shown, and which version; null follows the latest. */
  identifier: string | null;
  version: number | null;
  view: "preview" | "code";
  open(threadKey: string, identifier: string, version?: number | null): void;
  setVersion(version: number | null): void;
  setView(view: "preview" | "code"): void;
  close(): void;
}

/** The artifact side panel: one artifact at a time, beside the chat it's from. */
export const useArtifactPanel = create<ArtifactPanelState>((set) => ({
  threadKey: null,
  identifier: null,
  version: null,
  view: "preview",
  open: (threadKey, identifier, version = null) =>
    set({ threadKey, identifier, version, view: "preview" }),
  setVersion: (version) => set({ version }),
  setView: (view) => set({ view }),
  close: () => set({ threadKey: null, identifier: null, version: null }),
}));
