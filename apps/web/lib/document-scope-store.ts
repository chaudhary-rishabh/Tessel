import { create } from "zustand";

interface DocumentScopeState {
  /** The workspace the documents are in; the scope applies only there. */
  workspaceId: string | null;
  /** Documents the next messages search, by ID with their names; empty searches all of them. */
  documents: { id: string; filename: string }[];
  set(workspaceId: string, documents: { id: string; filename: string }[]): void;
  clear(): void;
  /** The picked documents for a workspace. */
  for(workspaceId: string): { id: string; filename: string }[];
}

/** "Search these documents": picked in the composer, kept until cleared. */
export const useDocumentScope = create<DocumentScopeState>((set, get) => ({
  workspaceId: null,
  documents: [],
  set: (workspaceId, documents) => set({ workspaceId, documents }),
  clear: () => set({ workspaceId: null, documents: [] }),
  for: (workspaceId) => (get().workspaceId === workspaceId ? get().documents : []),
}));
