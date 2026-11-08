"use client";

import { ArrowUp } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useSessionStore } from "@/lib/session-store";

function greetingFor(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// The hour comes from the browser's clock; the server renders a neutral greeting.
const subscribe = () => () => undefined;
const useGreeting = () =>
  useSyncExternalStore(
    subscribe,
    () => greetingFor(new Date().getHours()),
    () => "Welcome",
  );

export default function ChatPage() {
  const user = useSessionStore((state) => state.user);
  const greeting = useGreeting();
  const firstName = user?.name.split(/\s+/)[0] ?? "";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-6">
      <h1 className="text-center text-3xl font-medium tracking-tight sm:text-4xl">
        {greeting}, {firstName}
      </h1>

      <form
        className="mt-8"
        onSubmit={(event) => event.preventDefault()}
        aria-describedby="chat-note"
      >
        <div className="border-line bg-paper focus-within:border-accent rounded-2xl border p-3 shadow-sm">
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <textarea
            id="message"
            rows={3}
            disabled
            placeholder="Ask about your documents, or start a task"
            className="text-ink placeholder:text-muted/70 w-full resize-none bg-transparent px-1 text-base focus:outline-none disabled:cursor-not-allowed"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled
              aria-label="Send message"
              className="bg-accent text-accent-ink flex size-10 items-center justify-center rounded-full disabled:opacity-40"
            >
              <ArrowUp className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
      <p id="chat-note" className="text-muted mt-3 text-center text-sm">
        Chat is being built and arrives in the next update.
      </p>
    </div>
  );
}
