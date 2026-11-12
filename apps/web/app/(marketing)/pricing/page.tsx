import type { Metadata } from "next";
import { Faq } from "@/components/marketing/faq";
import { PageIntro } from "@/components/marketing/page-intro";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "Start free, then pick Pro, Max, or Team. Pay by card, or with UPI in India. Every paid plan includes every model and optional extra usage.",
  path: "/pricing",
});

const questions = [
  {
    question: "How do usage limits work?",
    answer:
      "Each plan includes a five-hour limit and a weekly limit, measured by how much AI work your messages take. Settings shows how much of each you've used and when it resets. Longer documents and more capable models use more.",
  },
  {
    question: "What happens when I reach a limit?",
    answer:
      "On Free, you wait until the limit resets. On a paid plan you can also turn on extra usage, with a monthly cap you choose, so work doesn't stop mid-task.",
  },
  {
    question: "Which models can I use?",
    answer:
      "Free includes everyday models. Pro, Max, and Team include every model, including the most capable ones.",
  },
  {
    question: "Can I cancel any time?",
    answer:
      "Yes. Your plan stays active until the end of the period you've paid for, then moves to Free. You can keep it from the same page before then.",
  },
  {
    question: "How does Team billing work?",
    answer:
      "Team is billed per person each month, from two people. Everyone shares the workspace's documents, skills, and connected apps, and admins get member controls and an audit log.",
  },
  {
    question: "How can I pay?",
    answer: "By card through Stripe, or in India with UPI or an Indian card through Razorpay.",
  },
] as const;

export default function PricingPage() {
  return (
    <>
      <PageIntro title="Simple plans that grow with your team">
        <p>Start free. Upgrade when Tessel becomes part of your day.</p>
      </PageIntro>
      <section aria-label="Plans" className="mx-auto max-w-6xl px-5 pb-20 sm:px-6">
        <PricingPlans />
      </section>
      <section className="mx-auto max-w-4xl px-5 pb-24 sm:px-6">
        <h2 className="mb-8 text-3xl font-semibold tracking-tight">Questions about plans</h2>
        <Faq items={questions} />
      </section>
    </>
  );
}
