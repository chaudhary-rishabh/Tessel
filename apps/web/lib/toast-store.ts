import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  tone: "success" | "error";
}

interface ToastState {
  toasts: Toast[];
  show(message: string, tone?: Toast["tone"]): void;
  dismiss(id: number): void;
}

let nextId = 1;

/**
 * Short confirmations for actions that finish away from their form (a member
 * removed, an invitation sent). Each disappears after a few seconds.
 */
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  show(message, tone = "success") {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-2), { id, message, tone }] });
    setTimeout(() => get().dismiss(id), tone === "error" ? 8000 : 4000);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },
}));

/** Shorthand for showing a toast from an event handler. */
export const toast = {
  success: (message: string) => useToasts.getState().show(message, "success"),
  error: (message: string) => useToasts.getState().show(message, "error"),
};
