import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeStorage } from "./safe-storage";

interface ChatPreferences {
  /** The model new chats start with. Null means the server's default. */
  modelId: string | null;
  setModelId: (modelId: string) => void;
}

export const useChatPreferences = create<ChatPreferences>()(
  persist(
    (set) => ({
      modelId: null,
      setModelId: (modelId) => set({ modelId }),
    }),
    { name: "tessel.chat", storage: safeStorage },
  ),
);
