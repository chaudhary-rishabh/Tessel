import { Plus } from "lucide-react";

/** Questions and answers that open one at a time, with no script. */
export function Faq({ items }: { items: readonly { question: string; answer: string }[] }) {
  return (
    <div className="divide-line border-line divide-y border-y">
      {items.map((item) => (
        <details key={item.question} className="group">
          <summary className="focus-visible:outline-accent flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-lg font-medium focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
            {item.question}
            <Plus
              aria-hidden="true"
              className="text-muted size-5 shrink-0 transition-transform group-open:rotate-45 motion-reduce:transition-none"
            />
          </summary>
          <p className="text-muted -mt-1 max-w-3xl pb-6">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
