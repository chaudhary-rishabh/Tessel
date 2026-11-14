import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { Logger } from "@tessel/logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Sends account emails: signup codes, password resets, notices. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface OutboxMailer extends Mailer {
  messages: (MailMessage & { sentAt: string })[];
  /** The newest message to an address, if any. */
  latest(to: string): (MailMessage & { sentAt: string }) | undefined;
}

/**
 * Keeps emails in memory instead of sending them, for development and tests.
 * In development the API also serves them at GET /dev/outbox.
 */
export function createOutboxMailer({
  logger,
  limit = 500,
}: { logger?: Logger; limit?: number } = {}): OutboxMailer {
  const messages: (MailMessage & { sentAt: string })[] = [];
  return {
    messages,
    async send(message) {
      messages.push({ ...message, sentAt: new Date().toISOString() });
      if (messages.length > limit) messages.splice(0, messages.length - limit);
      logger?.info(
        { to: message.to, subject: message.subject },
        "Email kept in the development outbox",
      );
    },
    latest: (to) => messages.findLast((message) => message.to === to.toLowerCase()),
  };
}

/** Sends through Amazon SES; the instance role supplies credentials in production. */
export function createSesMailer({ region, from }: { region: string; from: string }): Mailer {
  const client = new SESv2Client({ region });
  return {
    async send({ to, subject, text }) {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: "UTF-8" },
              Body: { Text: { Data: text, Charset: "UTF-8" } },
            },
          },
        }),
      );
    },
  };
}

const signature = "\n\n— Tessel";

/** The account emails Tessel sends, as plain text. */
export const emails = {
  confirmEmail: (to: string, link: string): MailMessage => ({
    to,
    subject: "Confirm your email for Tessel",
    text: `Welcome to Tessel. Confirm this is your email address so you can join your team's workspaces and recover your account:\n\n${link}\n\nOpen it while you're logged in to Tessel. It works for 7 days.\n\nIf you didn't create a Tessel account, you can ignore this email; the account can't do anything in your name, and you can take it over by resetting the password.${signature}`,
  }),
  passwordReset: (to: string, link: string): MailMessage => ({
    to,
    subject: "Reset your Tessel password",
    text: `Use this link to choose a new password. It works once, for 30 minutes:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email; your password hasn't changed.${signature}`,
  }),
  passwordChanged: (to: string): MailMessage => ({
    to,
    subject: "Your Tessel password was changed",
    text: `Your password was just changed, and you were signed out everywhere else. If this wasn't you, reset your password right away.${signature}`,
  }),
  invitation: (
    to: string,
    input: { inviter: string; workspace: string; role: string; link: string },
  ): MailMessage => ({
    to,
    subject: `${input.inviter} invited you to ${input.workspace} on Tessel`,
    text: `${input.inviter} invited you to join the ${input.workspace} workspace on Tessel as ${input.role === "admin" ? "an admin" : "a member"}.\n\nAccept the invitation: ${input.link}\n\nIt works for 7 days. Sign in or sign up with this email address (${to}) to accept. If you weren't expecting it, you can ignore this email.${signature}`,
  }),
  signInMethodAdded: (to: string, method: string): MailMessage => ({
    to,
    subject: "A new way to sign in was added to your Tessel account",
    text: `You can now sign in to Tessel with ${method}. If this wasn't you, change your password and remove it in Settings right away.${signature}`,
  }),
  twoFactorChanged: (to: string, enabled: boolean): MailMessage => ({
    to,
    subject: enabled ? "Two-step sign-in is on" : "Two-step sign-in was turned off",
    text: enabled
      ? `From now on, signing in to Tessel asks for a code from your authenticator app. Keep your recovery codes somewhere safe.${signature}`
      : `Signing in to Tessel no longer asks for an authenticator code. If this wasn't you, change your password right away.${signature}`,
  }),
  weeklyLimitNear: (
    to: string,
    input: { workspace: string; percent: number; resets: string; link: string; canExtra: boolean },
  ): MailMessage => ({
    to,
    subject: `You've used ${input.percent}% of your weekly Tessel limit`,
    text: `You've used ${input.percent}% of your weekly usage limit in ${input.workspace}. It resets ${input.resets}.\n\n${input.canExtra ? "To keep going past the limit, an owner or admin can turn on extra usage" : "For higher limits, upgrade your plan"}: ${input.link}\n\nWe send this once a week at most.${signature}`,
  }),
  extraUsageCapNear: (
    to: string,
    input: { workspace: string; spent: string; cap: string; link: string },
  ): MailMessage => ({
    to,
    subject: `${input.workspace} has used most of its extra usage cap`,
    text: `${input.workspace} has spent ${input.spent} of its ${input.cap} monthly extra usage cap on Tessel. When it reaches the cap, people who are past their limits wait for them to reset.\n\nRaise the cap or turn extra usage off: ${input.link}\n\nWe send this once a month at most.${signature}`,
  }),
};
