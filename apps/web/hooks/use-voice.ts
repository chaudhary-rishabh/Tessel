"use client";

import { useVoiceStatus } from "@tessel/api-client/react";
import { useEffect } from "react";
import { useVoiceStore, type VoiceRequest } from "@/lib/voice-store";

/**
 * Starts a voice conversation in this workspace, or undefined when the server
 * doesn't offer voice (the voice button then doesn't show).
 */
export function useStartVoice(
  workspaceId: string | undefined,
): ((options?: Omit<VoiceRequest, "workspaceId">) => void) | undefined {
  const status = useVoiceStatus(workspaceId);
  const start = useVoiceStore((state) => state.start);
  const available = Boolean(workspaceId && status.data?.available);

  // Fetch voice mode's code ahead of time, so the first tap opens it at once.
  useEffect(() => {
    if (!available) return;
    const idle =
      window.requestIdleCallback ?? ((callback: () => void) => setTimeout(callback, 1500));
    idle(() => void import("@/components/voice/voice-mode"));
  }, [available]);

  if (!available || !workspaceId) return undefined;
  return (options = {}) => start({ workspaceId, ...options });
}
