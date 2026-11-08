import { createJSONStorage } from "zustand/middleware";

// localStorage can throw (private mode, blocked storage); fall back to memory.
export const safeStorage = createJSONStorage(() => {
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
