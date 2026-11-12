import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { pageMetadata, site } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Terms of service",
  description:
    "The terms for using Tessel: accounts, acceptable use, plans and billing, and your content.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="2026-11-12">
      <p>
        These terms cover your use of Tessel at tessel.chat. By creating an account, you agree to
        them.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>
          Keep your sign-in details safe. You&apos;re responsible for what happens in your account.
        </li>
        <li>Give accurate information, and keep your email address current so we can reach you.</li>
        <li>Workspace owners decide who joins their team workspace and what role they have.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        You own what you put into Tessel and what it produces for you. You give us permission to
        store and process it only as needed to run the service for you. Make sure you have the right
        to upload what you share.
      </p>

      <h2>Acceptable use</h2>
      <p>Don&apos;t use Tessel to:</p>
      <ul>
        <li>break the law or infringe anyone&apos;s rights;</li>
        <li>create harmful content, malware, or spam;</li>
        <li>get around usage limits, security controls, or another workspace&apos;s isolation;</li>
        <li>overload, probe, or disrupt the service.</li>
      </ul>
      <p>We may suspend accounts that do.</p>

      <h2>AI output</h2>
      <p>
        AI answers can be wrong. Check important answers against their sources before you rely on
        them, especially for legal, medical, or financial decisions.
      </p>

      <h2>Plans and billing</h2>
      <ul>
        <li>
          Paid plans renew each month until you cancel. Cancelling keeps your plan until the end of
          the period you&apos;ve paid for.
        </li>
        <li>Extra usage, if you turn it on, is charged up to the monthly cap you set.</li>
        <li>We&apos;ll tell you before changing a plan&apos;s price.</li>
      </ul>

      <h2>The service</h2>
      <p>
        We work to keep Tessel available and your data safe, but we provide the service as it is,
        without guarantees beyond those the law requires. You can stop using Tessel at any time.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If these terms change in a way that matters, we&apos;ll tell you before the change takes
        effect. Questions? Email <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
      </p>
    </LegalPage>
  );
}
