import { create } from "zustand";

interface ImageReferenceState {
  /** The image the next message is about, sent as [image:ID] so the model edits that one. */
  imageId: string | null;
  set(imageId: string): void;
  clear(): void;
}

/** "Edit this image": picked from a reply or the gallery, shown on the composer until sent. */
export const useImageReference = create<ImageReferenceState>((set) => ({
  imageId: null,
  set: (imageId) => set({ imageId }),
  clear: () => set({ imageId: null }),
}));
