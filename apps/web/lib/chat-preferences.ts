import type { AgentModeName, KnowledgeMode } from "@tessel/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeStorage } from "./safe-storage";

interface ChatPreferences {
  /** The model new chats start with. Null means the server's default. */
  modelId: string | null;
  setModelId: (modelId: string) => void;
  /** When to search the workspace's documents. */
  knowledge: KnowledgeMode;
  setKnowledge: (knowledge: KnowledgeMode) => void;
  /** How replies are worked out: answer, plan, review, or team. */
  mode: AgentModeName;
  setMode: (mode: AgentModeName) => void;
}

export const useChatPreferences = create<ChatPreferences>()(
  persist(
    (set) => ({
      modelId: null,
      setModelId: (modelId) => set({ modelId }),
      knowledge: "auto",
      setKnowledge: (knowledge) => set({ knowledge }),
      mode: "auto",
      setMode: (mode) => set({ mode }),
    }),
    { name: "tessel.chat", storage: safeStorage },
  ),
);
