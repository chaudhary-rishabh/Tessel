import { PublishCommand, SNSClient, type MessageAttributeValue } from "@aws-sdk/client-sns";
import type { Logger } from "@tessel/logger";

export interface SmsMessage {
  /** E.164, like +919876543210. */
  to: string;
  text: string;
}

/** Sends text messages: sign-in and phone confirmation codes. */
export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}

export interface OutboxSms extends SmsSender {
  messages: (SmsMessage & { sentAt: string })[];
  latest(to: string): (SmsMessage & { sentAt: string }) | undefined;
}

/** Keeps texts in memory instead of sending them, for development and tests (GET /dev/outbox). */
export function createOutboxSms({
  logger,
  limit = 500,
}: { logger?: Logger; limit?: number } = {}): OutboxSms {
  const messages: (SmsMessage & { sentAt: string })[] = [];
  return {
    messages,
    async send(message) {
      messages.push({ ...message, sentAt: new Date().toISOString() });
      if (messages.length > limit) messages.splice(0, messages.length - limit);
      logger?.info({ to: message.to }, "Text kept in the development outbox");
    },
    latest: (to) => messages.findLast((message) => message.to === to),
  };
}

export interface SnsSmsOptions {
  region: string;
  /** An alphanumeric sender ID, where the destination country supports one. */
  senderId?: string | undefined;
  /** India's DLT registration, required to text Indian numbers. */
  dltEntityId?: string | undefined;
  dltTemplateId?: string | undefined;
}

/** Sends through Amazon SNS as transactional texts; the instance role supplies credentials. */
export function createSnsSms({
  region,
  senderId,
  dltEntityId,
  dltTemplateId,
}: SnsSmsOptions): SmsSender {
  const client = new SNSClient({ region });
  const attribute = (value: string): MessageAttributeValue => ({
    DataType: "String",
    StringValue: value,
  });
  const attributes: Record<string, MessageAttributeValue> = {
    "AWS.SNS.SMS.SMSType": attribute("Transactional"),
    ...(senderId ? { "AWS.SNS.SMS.SenderID": attribute(senderId) } : {}),
    ...(dltEntityId ? { "AWS.MM.SMS.EntityId": attribute(dltEntityId) } : {}),
    ...(dltTemplateId ? { "AWS.MM.SMS.TemplateId": attribute(dltTemplateId) } : {}),
  };
  return {
    async send({ to, text }) {
      await client.send(
        new PublishCommand({ PhoneNumber: to, Message: text, MessageAttributes: attributes }),
      );
    },
  };
}

/** The texts Tessel sends. Kept short: one SMS segment. */
export const texts = {
  code: (to: string, code: string, purpose: "login" | "verify"): SmsMessage => ({
    to,
    text:
      purpose === "login"
        ? `${code} is your Tessel sign-in code. It expires in 10 minutes. Don't share it.`
        : `${code} is your Tessel code to confirm this number. It expires in 10 minutes.`,
  }),
};
