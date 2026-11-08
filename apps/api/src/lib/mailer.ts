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
  signupCode: (to: string, code: string): MailMessage => ({
    to,
    subject: `${code} is your Tessel code`,
    text: `Enter this code to finish creating your Tessel account:\n\n${code}\n\nIt works for 15 minutes. If you didn't try to sign up, you can ignore this email.${signature}`,
  }),
  accountExists: (to: string, webOrigin: string): MailMessage => ({
    to,
    subject: "You already have a Tessel account",
    text: `Someone tried to create a Tessel account with this email address, but you already have one.\n\nLog in: ${webOrigin}/login\nForgot your password? ${webOrigin}/forgot-password\n\nIf this wasn't you, you can ignore this email; nothing has changed.${signature}`,
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
};
