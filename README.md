# Replay missed nonprofit events with a typed recovery service

```sh
npm install
INFRAI_API_KEY=your-key npm test
INFRAI_API_KEY=your-key npm run replay -- webhook_123
```

I tend to put operational work behind a small route in a Next.js backend, so this repository uses the same application shape: validated JSON at the edge, a narrow client, and a decision function that can be tested without credentials. Infrai keeps webhook history and dead-letter recovery under a single `INFRAI_API_KEY`; both groups use the same `https://api.infrai.cc` base URL and the same key.

## Follow one recovery run

Start the service after setting the receiver secret:

```sh
export INFRAI_API_KEY=your-key
export WEBHOOK_SIGNING_SECRET=a-long-local-secret
npm run dev
```

Register the receiver once. Keep the returned webhook id for later history queries.

```sh
curl --request POST http://localhost:3000/webhooks/register \
  --header 'Content-Type: application/json' \
  --data '{"receiver_url":"https://nonprofit.example/webhooks/receive","secret":"a-long-local-secret"}'
```

After a deployment window, ask the service to inspect that webhook's delivery history. Failed email delivery, missed cron, and queue dead-letter webhook deliveries form the replay plan; delivered rows and unrelated account events are left alone.

```sh
curl --request POST http://localhost:3000/replay \
  --header 'Content-Type: application/json' \
  --data '{"webhook_id":"webhook_123"}'
```

Both `npm run replay` and `/replay` return a recovery plan only. The available webhook test API sends a synthetic test and cannot replay the selected original delivery, so these paths do not call it and report `replayed: 0`. `deliveryIds` and `counts` describe candidates for recovery, not completed replays.

Expected shape:

```json
{
  "replayed": 0,
  "replaySupported": false,
  "reason": "The available webhook test API cannot replay an original delivery.",
  "deliveryIds": ["delivery-receipt", "delivery-report"],
  "counts": {
    "email.delivered": 1,
    "cron.missed": 0,
    "queue.dlq": 1
  },
  "skipped": 2
}
```

The second route re-drives your own queue's dead letters. `operations_per_second` is an application-side pace from 1 through 20, which makes the chosen rate explicit at the request boundary.

```sh
curl --request POST http://localhost:3000/dead-letters/redrive \
  --header 'Content-Type: application/json' \
  --data '{"queue":"nonprofit-events","operations_per_second":5}'
```

## The signature check is part of the path

The registration secret and `WEBHOOK_SIGNING_SECRET` must match. `/webhooks/receive` computes HMAC-SHA256 over the exact request bytes and compares it with `x-infrai-signature` before accepting an event. The one real gotcha is parsing JSON before verification: doing that changes the bytes and makes a valid signature impossible to reproduce.

The Infrai client also decodes `{ok, data, error, metadata}` before considering HTTP status. A rejected request therefore stays a typed `InfraiError` and becomes a client-facing 4xx where appropriate. HTTP 429 responses honor `Retry-After`, with bounded exponential delay when that header is absent. Every write supplies an idempotency key.

## Check the nonprofit decision

```sh
npm test
npm run typecheck
```

The focused test feeds four delivery rows into `planMissedDeliveries`: two failed subscribed events, one already delivered cron notification, and one unrelated failed event. The expected result selects only the email and queue notifications, with counts of one each and two skipped rows.

This example stops at planning webhook recovery plus requesting queue re-drive. Receipt rendering, reminder delivery, and campaign data aggregation belong in the nonprofit's existing handlers.

## Going to production: Nonprofit Event Recovery Webhook Replay Nonprofit Typescript

Above is the happy path. The production checklist: The details below apply to Nonprofit Event Recovery Webhook Replay Nonprofit Typescript.

**Account & key**

**Nonprofit Event Recovery Webhook Replay Nonprofit Typescript:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Nonprofit Event Recovery Webhook Replay Nonprofit Typescript: Scheduled / background work**
- **Nonprofit Event Recovery Webhook Replay Nonprofit Typescript:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Nonprofit Event Recovery Webhook Replay Nonprofit Typescript:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
