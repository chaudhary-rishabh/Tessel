import { TesselMark } from "@tessel/ui";
import { ArrowUp, FileText, MessageSquare, Paperclip, Settings } from "lucide-react";

/**
 * A still picture of Tessel at work, drawn in HTML so it stays sharp and
 * follows the theme: a cited answer, and an action waiting for approval.
 * Decorative: the page around it says the same thing in words.
 */
export function ProductPreview() {
  return (
    <div
      aria-hidden="true"
      className="bg-paper text-ink border-line/60 overflow-hidden rounded-t-[1.25rem] border border-b-0 text-left shadow-[0_-12px_60px_-20px_rgba(0,0,0,0.45)] sm:rounded-t-[1.5rem]"
    >
      <div className="border-line flex h-10 items-center gap-2 border-b px-4">
        <span className="size-3 rounded-full bg-[#e5715f]" />
        <span className="size-3 rounded-full bg-[#e8b84a]" />
        <span className="size-3 rounded-full bg-[#6cbf73]" />
        <span className="bg-surface border-line text-muted mx-auto hidden rounded-full border px-10 py-1 text-xs sm:block">
          tessel.chat/chat
        </span>
      </div>

      <div className="grid min-h-[22rem] grid-cols-1 sm:min-h-[26rem] md:grid-cols-[13.5rem_1fr]">
        <div className="border-line hidden flex-col gap-1 border-r p-3 text-sm md:flex">
          <div className="flex items-center gap-2 px-2 py-2">
            <TesselMark className="size-6" />
            <span className="font-medium">Acme product team</span>
          </div>
          <div className="bg-surface border-line mt-2 rounded-lg border px-3 py-2 font-medium">
            New chat
          </div>
          <div className="bg-ink/6 mt-1 flex items-center gap-2 rounded-lg px-3 py-2">
            <MessageSquare className="size-4" /> Chat
          </div>
          <div className="text-muted flex items-center gap-2 px-3 py-2">
            <FileText className="size-4" /> Documents
          </div>
          <div className="text-muted flex items-center gap-2 px-3 py-2">
            <Settings className="size-4" /> Settings
          </div>
          <p className="text-muted mt-4 px-3 text-xs">Recent chats</p>
          <div className="bg-ink/6 rounded-lg px-3 py-2 text-[0.8rem]">Q3 launch checklist</div>
          <div className="text-muted px-3 py-2 text-[0.8rem]">Refund policy for EU</div>
          <div className="text-muted px-3 py-2 text-[0.8rem]">Onboarding plan</div>
        </div>

        <div className="flex flex-col gap-4 p-4 text-[0.85rem] sm:p-6 sm:text-sm">
          <div className="bg-surface border-line ml-auto max-w-[85%] rounded-2xl border px-4 py-3">
            What do we still need before the Q3 launch? Make a checklist doc for the team.
          </div>

          <div className="max-w-[92%] leading-relaxed">
            <p>
              Three things are still open. Legal review of the new terms is due on 14 August
              <Cite n={1} />, the pricing page needs the India prices <Cite n={2} />, and support
              wants the updated help articles a week before launch <Cite n={3} />.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {["Launch plan.pdf", "Pricing notes.md", "Support handbook.docx"].map((name, i) => (
                <span
                  key={name}
                  className="bg-surface border-line text-muted inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                >
                  <span className="bg-accent/12 text-accent grid size-4 place-items-center rounded-full text-[0.6rem] font-semibold">
                    {i + 1}
                  </span>
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-surface border-line max-w-md rounded-2xl border p-4">
            <p className="font-medium">Create a document?</p>
            <p className="text-muted mt-1 text-xs sm:text-[0.8rem]">
              &ldquo;Q3 launch checklist&rdquo; in Documents, shared with the team.
            </p>
            <div className="mt-3 flex gap-2">
              <span className="bg-accent text-accent-ink rounded-lg px-3.5 py-1.5 text-xs font-medium">
                Allow
              </span>
              <span className="border-line rounded-lg border px-3.5 py-1.5 text-xs font-medium">
                Decline
              </span>
            </div>
          </div>

          <div className="bg-surface border-line mt-auto flex items-center gap-3 rounded-2xl border px-4 py-3">
            <Paperclip className="text-muted size-4" />
            <span className="text-muted flex-1">Reply to Tessel</span>
            <span className="bg-accent text-accent-ink grid size-7 place-items-center rounded-full">
              <ArrowUp className="size-4" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <sup className="bg-accent/12 text-accent ml-0.5 rounded px-1 py-px text-[0.65rem] font-semibold">
      {n}
    </sup>
  );
}
