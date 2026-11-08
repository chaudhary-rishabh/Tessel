import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface WorkspaceState {
  /** The workspace the user last opened. A convenience only; the API decides access. */
  currentWorkspaceId: string | null;
  setCurrentWorkspace: (workspaceId: string) => void;
}

// localStorage can throw (private mode, blocked storage); fall back to memory.
const safeStorage = createJSONStorage(() => {
  try {
    const probe = "__tessel_probe__";
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
  }
});

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      setCurrentWorkspace: (workspaceId) => set({ currentWorkspaceId: workspaceId }),
    }),
    { name: "tessel.workspace", storage: safeStorage },
  ),
);
