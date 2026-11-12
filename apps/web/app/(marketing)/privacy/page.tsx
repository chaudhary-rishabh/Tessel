import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { pageMetadata, site } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Privacy policy",
  description: "What Tessel collects, why, who processes it, and how to see or delete your data.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="2026-11-12">
      <p>
        This policy explains what Tessel collects when you use tessel.chat, why, and the choices you
        have. We collect only what we need to run the service, and we don&apos;t sell your data.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> your name, email address, and, if you add them, a phone
          number and the Google or GitHub account you sign in with.
        </li>
        <li>
          <strong>What you put in Tessel:</strong> your chats, uploaded documents, skills, memory,
          and the settings of apps you connect.
        </li>
        <li>
          <strong>Usage and security records:</strong> how much AI usage you consume, sign-ins and
          other security events with the IP address they came from, and your signed-in devices.
        </li>
        <li>
          <strong>Billing:</strong> your plan and payment status. Card and UPI details go straight
          to our payment providers; we never see or store them.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>
          To run Tessel: answer your messages, search your documents, and carry out the tasks you
          approve.
        </li>
        <li>To keep accounts and workspaces secure, prevent abuse, and enforce plan limits.</li>
        <li>
          To send the emails and texts the service needs, such as sign-in codes and security
          notices.
        </li>
      </ul>
      <p>We don&apos;t use your documents or chats to train AI models.</p>

      <h2>Who processes it</h2>
      <p>We use these providers to run Tessel, each only for its part of the service:</p>
      <ul>
        <li>Amazon Web Services: servers, databases, file storage, email, and texts.</li>
        <li>Vercel: hosting the website, and routing AI requests to model providers.</li>
        <li>AI model providers: the content of a request, to produce its answer.</li>
        <li>Stripe and Razorpay: payments.</li>
        <li>Google and GitHub: only if you choose to sign in with them.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>
          See, edit, or delete what Tessel remembers about you, or switch memory off, in Settings.
        </li>
        <li>
          Delete documents and chats at any time. Owners can delete a team workspace and everything
          in it.
        </li>
        <li>Sign out any device, and turn on two-step sign-in.</li>
        <li>
          To get a copy of your data or delete your account, email{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        We keep your content until you delete it or your account is closed. Security records are
        kept for a year. Backups are removed on a rolling schedule.
      </p>

      <h2>Cookies</h2>
      <p>
        Tessel uses only the cookies it needs to keep you signed in and to complete sign-ins with
        other services. There are no advertising or tracking cookies.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If this policy changes in a way that matters, we&apos;ll tell you by email or in the app.
        Questions? Email <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
      </p>
    </LegalPage>
  );
}
