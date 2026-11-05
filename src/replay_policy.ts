import type { Delivery } from "./infrai_client.js";

export const nonprofitEvents = [
  "email.delivered",
  "cron.missed",
  "queue.dlq"
] as const;

export type NonprofitEvent = (typeof nonprofitEvents)[number];

export type ReplayPlan = {
  deliveryIds: string[];
  counts: Record<NonprofitEvent, number>;
  skipped: number;
};

export function planMissedDeliveries(deliveries: Delivery[]): ReplayPlan {
  const counts: Record<NonprofitEvent, number> = {
    "email.delivered": 0,
    "cron.missed": 0,
    "queue.dlq": 0
  };
  const deliveryIds: string[] = [];
  let skipped = 0;

  for (const delivery of deliveries) {
    if ((delivery.response_status !== null && delivery.response_status >= 200 && delivery.response_status < 300) || !isNonprofitEvent(delivery.event)) {
      skipped += 1;
      continue;
    }
    deliveryIds.push(delivery.delivery_id);
    counts[delivery.event] += 1;
  }

  return { deliveryIds, counts, skipped };
}

function isNonprofitEvent(event: string): event is NonprofitEvent {
  return nonprofitEvents.some((candidate) => candidate === event);
}
