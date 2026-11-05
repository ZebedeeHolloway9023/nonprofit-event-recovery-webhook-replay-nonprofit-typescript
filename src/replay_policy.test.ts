import assert from "node:assert/strict";
import test from "node:test";
import { InfraiClient } from "./infrai_client.js";
import { planMissedDeliveries } from "./replay_policy.js";

test("replays only failed subscribed events and reports each event", () => {
  const plan = planMissedDeliveries([
    { delivery_id: "delivery-receipt", event: "email.delivered", response_status: 500, attempts: 1 },
    { delivery_id: "delivery-volunteer", event: "cron.missed", response_status: 204, attempts: 1 },
    { delivery_id: "delivery-report", event: "queue.dlq", response_status: 500, attempts: 1 },
    { delivery_id: "delivery-other", event: "account.updated", response_status: 500, attempts: 1 }
  ]);

  assert.deepEqual(plan.deliveryIds, ["delivery-receipt", "delivery-report"]);
  assert.deepEqual(plan.counts, {
    "email.delivered": 1,
    "cron.missed": 0,
    "queue.dlq": 1
  });
  assert.equal(plan.skipped, 2);
});

test("recovers every subscribed event and skips unsupported workflow names", () => {
  const events = ["email.delivered", "cron.missed", "queue.dlq"];
  const plan = planMissedDeliveries([
    ...events.map((event) => ({ delivery_id: event, event, response_status: 500, attempts: 1 })),
    ...["donation.receipt_requested", "volunteer.shift_upcoming", "campaign.reporting_due"]
      .map((event) => ({ delivery_id: event, event, response_status: 500, attempts: 1 }))
  ]);
  assert.deepEqual(plan.deliveryIds, events);
  assert.deepEqual(plan.counts, { "email.delivered": 1, "cron.missed": 1, "queue.dlq": 1 });
  assert.equal(plan.skipped, 3);
});

test("plans deliveries with no HTTP response and skips successful responses", () => {
  const plan = planMissedDeliveries([
    { delivery_id: "timeout", event: "queue.dlq", response_status: null, attempts: 1 },
    { delivery_id: "accepted", event: "queue.dlq", response_status: 202, attempts: 1 }
  ]);
  assert.deepEqual(plan.deliveryIds, ["timeout"]);
  assert.equal(plan.skipped, 1);
});

test("decodes documented delivery pages for recovery planning", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    data: {
      items: [
        { delivery_id: "failed", event: "email.delivered", response_status: 503, attempts: 2 },
        { delivery_id: "sent", event: "cron.missed", response_status: 200, attempts: 1 }
      ],
      next_cursor: null
    }
  }), { status: 200 });
  try {
    const rows = await new InfraiClient("test-key").account.webhooks.deliveries("webhook-test");
    assert.deepEqual(planMissedDeliveries(rows).deliveryIds, ["failed"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
