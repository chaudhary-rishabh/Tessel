import {
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { StorageEnv } from "./env";

export interface QueueMessage {
  body: string;
  receiptHandle: string;
  /** How many times SQS has delivered this message, including this time. */
  receiveCount: number;
}

/** The SQS queue that announces finished uploads. */
export interface UploadEventQueue {
  send(body: string): Promise<void>;
  /** Long-polls for messages; resolves with none after the wait time. */
  receive(options?: {
    maxMessages?: number;
    waitSeconds?: number;
    signal?: AbortSignal;
  }): Promise<QueueMessage[]>;
  delete(receiptHandle: string): Promise<void>;
  ping(): Promise<void>;
}

export function createSqsUploadQueue(
  env: Pick<StorageEnv, "AWS_REGION" | "SQS_UPLOADS_QUEUE_URL" | "SQS_ENDPOINT">,
): UploadEventQueue & { ensureQueue(): Promise<void>; client: SQSClient } {
  const client = new SQSClient({
    region: env.AWS_REGION,
    ...(env.SQS_ENDPOINT ? { endpoint: env.SQS_ENDPOINT } : {}),
  });
  const QueueUrl = env.SQS_UPLOADS_QUEUE_URL;

  return {
    client,

    async send(body) {
      await client.send(new SendMessageCommand({ QueueUrl, MessageBody: body }));
    },

    async receive({ maxMessages = 10, waitSeconds = 20, signal } = {}) {
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitSeconds,
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        }),
        signal ? { abortSignal: signal } : {},
      );
      return (response.Messages ?? []).flatMap((message) =>
        message.Body && message.ReceiptHandle
          ? [
              {
                body: message.Body,
                receiptHandle: message.ReceiptHandle,
                receiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? 1),
              },
            ]
          : [],
      );
    },

    async delete(receiptHandle) {
      await client.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: receiptHandle }));
    },

    async ping() {
      await client.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ["QueueArn"] }));
    },

    async ensureQueue() {
      // The queue name is the last part of the URL.
      const name = new URL(QueueUrl).pathname.split("/").filter(Boolean).pop();
      if (!name) throw new Error("SQS_UPLOADS_QUEUE_URL must end with the queue name");
      await client.send(new CreateQueueCommand({ QueueName: name }));
    },
  };
}
