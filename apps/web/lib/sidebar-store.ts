import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeStorage } from "./safe-storage";

interface SidebarState {
  /** Whether the wide-screen sidebar is folded down to its icon rail. Remembered per browser. */
  collapsed: boolean;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      toggle: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    { name: "tessel.sidebar", storage: safeStorage },
  ),
);
