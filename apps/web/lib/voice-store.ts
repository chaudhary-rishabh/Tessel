import { create } from "zustand";

/** What a voice conversation was started with: where, and which chat and model. */
export interface VoiceRequest {
  workspaceId: string;
  /** Continue this chat by voice; omitted starts a new chat. */
  threadId?: string | undefined;
  model?: string | undefined;
}

interface VoiceState {
  /** The conversation in progress, if any. Voice mode is open while it's set. */
  request: VoiceRequest | null;
  start(request: VoiceRequest): void;
  close(): void;
}

/** Voice mode is one full-screen layer for the whole app, opened from any composer. */
export const useVoiceStore = create<VoiceState>((set, get) => ({
  request: null,
  start(request) {
    if (get().request) return;
    set({ request });
  },
  close() {
    set({ request: null });
  },
}));
