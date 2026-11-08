// A stand-in for Amazon SES in the CI smoke test. It accepts the SESv2
// SendEmail call the API makes and keeps the messages, so the test can read
// a signup code: GET /messages?to=address. Not used anywhere else.
import { createServer } from "node:http";

const messages = [];
const port = Number(process.env.PORT ?? 8005);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://mock-ses");
  const reply = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && url.pathname === "/health") return reply(200, { status: "ok" });
  if (req.method === "GET" && url.pathname === "/messages") {
    const to = url.searchParams.get("to");
    return reply(200, { messages: messages.filter((message) => !to || message.to.includes(to)) });
  }
  if (req.method === "POST" && url.pathname === "/v2/email/outbound-emails") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const email = JSON.parse(body);
        messages.push({
          from: email.FromEmailAddress,
          to: email.Destination?.ToAddresses ?? [],
          subject: email.Content?.Simple?.Subject?.Data ?? "",
          text: email.Content?.Simple?.Body?.Text?.Data ?? "",
        });
        reply(200, { MessageId: `mock-${messages.length}` });
      } catch {
        reply(400, { message: "Invalid JSON" });
      }
    });
    return;
  }
  reply(404, { message: "Not found" });
}).listen(port, () => process.stdout.write(`Mock SES listening on ${port}\n`));
