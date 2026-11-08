"use client";

import { useModels } from "@tessel/api-client/react";
import { useChatPreferences } from "@/lib/chat-preferences";

/**
 * The model to send with: the thread's model when continuing a chat,
 * otherwise the user's last pick, as long as it's still offered.
 */
export function useChatModel(threadModelId?: string) {
  const models = useModels();
  const preferred = useChatPreferences((state) => state.modelId);
  const setPreferred = useChatPreferences((state) => state.setModelId);
  const available = models.data?.models ?? [];
  const isAvailable = (id: string | null | undefined): id is string =>
    Boolean(id && available.some((model) => model.id === id));

  const modelId = isAvailable(threadModelId)
    ? threadModelId
    : isAvailable(preferred)
      ? preferred
      : models.data?.defaultModel;
  return { modelId, setModelId: setPreferred };
}
