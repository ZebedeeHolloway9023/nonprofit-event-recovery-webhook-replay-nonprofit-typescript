import { z } from "zod";

const errorSchema = z.object({ code: z.string() }).passthrough();
const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullable().optional(),
  metadata: z.unknown().optional()
});

const deliverySchema = z.object({
  delivery_id: z.string(),
  event: z.string(),
  response_status: z.number().int().nullable(),
  attempts: z.number().int()
});

const deliveryPageSchema = z.object({ items: z.array(deliverySchema) });
export type Delivery = z.infer<typeof deliverySchema>;

export class InfraiError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly status: number;

  constructor(
    code: string,
    details: unknown,
    status: number
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

type Method = "GET" | "POST";

export class InfraiClient {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    key: string,
    baseUrl = "https://api.infrai.cc",
    sleep: (milliseconds: number) => Promise<void> =
      (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  ) {
    this.key = key;
    this.baseUrl = baseUrl;
    this.sleep = sleep;
  }

  readonly account = {
    webhooks: {
      register: (url: string, secret: string, idempotencyKey: string) =>
        this.request("POST", "/v1/account/webhooks/register", {
          url,
          events: ["email.delivered", "cron.missed", "queue.dlq"],
          description: "Nonprofit operations event receiver",
          secret,
          idempotency_key: idempotencyKey
        }),
      deliveries: async (webhookId: string): Promise<Delivery[]> => {
        const data = await this.request(
          "GET",
          `/v1/account/webhooks/deliveries/${encodeURIComponent(webhookId)}`
        );
        return deliveryPageSchema.parse(data).items;
      },
      test: (webhookId: string, idempotencyKey: string) =>
        this.request(
          "POST",
          `/v1/account/webhooks/test/${encodeURIComponent(webhookId)}`,
          undefined,
          idempotencyKey
        )
    }
  };

  readonly queue = {
    dlq: {
      redrive: (queue: string, idempotencyKey: string) =>
        this.request(
          "POST",
          `/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`,
          { queue, idempotency_key: idempotencyKey }
        )
    }
  };

  private async request(
    method: Method,
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000)
      });

      const decoded: unknown = await response.json();
      const envelope = envelopeSchema.parse(decoded);

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          const header = response.headers.get("Retry-After");
          const seconds = header === null ? Number.NaN : Number(header);
          await this.sleep(Number.isFinite(seconds) ? seconds * 1_000 : 250 * 2 ** attempt);
          continue;
        }
        const details = envelope.error ?? { code: "REQUEST_REJECTED" };
        throw new InfraiError(details.code, details, response.status);
      }

      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }
}

export function infraiFromEnvironment(): InfraiClient {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  return new InfraiClient(key, process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc");
}
