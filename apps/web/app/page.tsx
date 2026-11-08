const capabilities = [
  "Chat with streaming answers",
  "Answers grounded in your documents",
  "Agents that ask before they act",
  "Your tools, connected through MCP",
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">Tessel</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
        One AI workspace for your team&apos;s knowledge and tools.
      </h1>
      <ul className="mt-8 space-y-2 text-lg text-neutral-600 dark:text-neutral-400">
        {capabilities.map((capability) => (
          <li key={capability} className="flex items-center gap-3">
            <span aria-hidden className="size-1.5 rounded-full bg-neutral-400" />
            {capability}
          </li>
        ))}
      </ul>
      <p className="mt-10 text-sm text-neutral-500">In development.</p>
    </main>
  );
}
