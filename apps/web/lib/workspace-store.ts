import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeStorage } from "./safe-storage";

interface WorkspaceState {
  /** The workspace the user last opened. A convenience only; the API decides access. */
  currentWorkspaceId: string | null;
  setCurrentWorkspace: (workspaceId: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      setCurrentWorkspace: (workspaceId) => set({ currentWorkspaceId: workspaceId }),
    }),
    { name: "tessel.workspace", storage: safeStorage },
  ),
);
