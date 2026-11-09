import { startMockPayments } from "./mock-payments";

// pnpm mock-payments: a mock Stripe and Razorpay for local development and end-to-end tests.
const payments = await startMockPayments({
  port: Number(process.env.MOCK_PAYMENTS_PORT ?? 4600),
  webhookUrl: process.env.MOCK_PAYMENTS_WEBHOOK_URL ?? "http://localhost:4000/billing/webhooks",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_test",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "rzp_webhook_test",
});
process.stdout.write(`Mock Stripe and Razorpay at ${payments.url}\n`);
