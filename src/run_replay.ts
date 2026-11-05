import { z } from "zod";
import { infraiFromEnvironment } from "./infrai_client.js";
import { planMissedDeliveries } from "./replay_policy.js";

const argumentsSchema = z.tuple([z.string().min(1)]);
const [webhookId] = argumentsSchema.parse(process.argv.slice(2));
const infrai = infraiFromEnvironment();
const plan = planMissedDeliveries(await infrai.account.webhooks.deliveries(webhookId));

console.log(JSON.stringify({
  webhook_id: webhookId,
  replayed: 0,
  ...plan,
  replaySupported: false,
  reason: "The available webhook test API cannot replay an original delivery."
}, null, 2));
