"use client";

import { cn } from "@tessel/ui";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useToasts } from "@/lib/toast-store";

/** Where toasts appear: bottom centre on phones, bottom right on larger screens. */
export function Toaster() {
  const toasts = useToasts((state) => state.toasts);
  const dismiss = useToasts((state) => state.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end"
    >
      {toasts.map((item) => {
        const Icon = item.tone === "error" ? CircleAlert : CircleCheck;
        return (
          <div
            key={item.id}
            role={item.tone === "error" ? "alert" : "status"}
            className={cn(
              "bg-ink text-paper pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm shadow-lg",
            )}
          >
            <Icon
              className={cn("mt-0.5 size-4 shrink-0", item.tone === "error" && "text-danger")}
              aria-hidden="true"
            />
            <p className="flex-1">{item.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(item.id)}
              className="hover:bg-paper/10 -m-1 rounded p-1"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
