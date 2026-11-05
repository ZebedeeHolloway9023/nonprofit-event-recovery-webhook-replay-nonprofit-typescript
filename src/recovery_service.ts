import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError, infraiFromEnvironment } from "./infrai_client.js";
import { planMissedDeliveries } from "./replay_policy.js";

const replaySchema = z.object({ webhook_id: z.string().min(1) }).strict();
const redriveSchema = z.object({
  queue: z.string().min(1),
  operations_per_second: z.number().int().min(1).max(20)
}).strict();
const registrationSchema = z.object({
  receiver_url: z.string().url(),
  secret: z.string().min(16)
}).strict();

const infrai = infraiFromEnvironment();

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function signatureIsValid(body: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const supplied = Buffer.from(signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "POST" && request.url === "/webhooks/register") {
    const input = registrationSchema.parse(JSON.parse((await readBody(request)).toString("utf8")));
    const data = await infrai.account.webhooks.register(
      input.receiver_url,
      input.secret,
      `webhook-registration:${input.receiver_url}`
    );
    send(response, 201, data);
    return;
  }

  if (request.method === "POST" && request.url === "/replay") {
    const input = replaySchema.parse(JSON.parse((await readBody(request)).toString("utf8")));
    const plan = planMissedDeliveries(await infrai.account.webhooks.deliveries(input.webhook_id));
    send(response, 200, {
      replayed: 0,
      ...plan,
      replaySupported: false,
      reason: "The available webhook test API cannot replay an original delivery."
    });
    return;
  }

  if (request.method === "POST" && request.url === "/dead-letters/redrive") {
    const input = redriveSchema.parse(JSON.parse((await readBody(request)).toString("utf8")));
    const interval = 1_000 / input.operations_per_second;
    await new Promise((resolve) => setTimeout(resolve, interval));
    const data = await infrai.queue.dlq.redrive(input.queue, `nonprofit-redrive:${randomUUID()}`);
    send(response, 202, { queue: input.queue, operations_per_second: input.operations_per_second, data });
    return;
  }

  if (request.method === "POST" && request.url === "/webhooks/receive") {
    const body = await readBody(request);
    const secret = process.env.WEBHOOK_SIGNING_SECRET;
    const signature = request.headers["x-infrai-signature"];
    if (!secret || typeof signature !== "string" || !signatureIsValid(body, signature, secret)) {
      send(response, 401, { error: "invalid_signature" });
      return;
    }
    send(response, 202, { accepted: true });
    return;
  }

  send(response, 404, { error: "route_not_found" });
}

const server = createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      send(response, 400, { error: "invalid_request" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, details: error.details });
      return;
    }
    send(response, 502, { error: "transport_error" });
  });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Nonprofit recovery service listening on http://localhost:${port}`));
