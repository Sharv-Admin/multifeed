import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./test-utils/load-module.ts";
import { testDatabase } from "./test-utils/database.ts";

const billing = await loadModule("../convex/billing.ts");
const baseline = {
  _id: "sub-1",
  teamId: "team-1",
  userId: "user-1",
  planKey: "creator",
  interval: "month",
  status: "on_hold",
  dodoSubscriptionId: "provider-sub-1",
  dodoProductId: "product-1",
  createdAt: 1,
  updatedAt: 2,
  rawEventTimestamp: 1000,
};

async function apply(
  fixture: ReturnType<typeof testDatabase>,
  status: unknown,
  eventType = "subscription.updated",
  webhookId = "event-1",
  eventTimestamp = 2000,
) {
  const data = {
    subscription_id: "provider-sub-1",
    ...(status === undefined ? {} : { status }),
  };
  return billing.handleWebhook._handler(fixture.ctx, {
    webhookId,
    eventType,
    eventTimestamp,
    data,
    rawEvent: { type: eventType, data },
  });
}

for (const status of [
  "paused",
  "past_due",
  undefined,
  "unknown_future_status",
]) {
  test(`generic ${String(status)} update does not activate an on-hold subscription`, async () => {
    const fixture = testDatabase({ billingSubscriptions: [baseline] });
    await apply(fixture, status);
    const subscription = fixture.tables.billingSubscriptions![0]!;
    assert.equal(subscription.status, "on_hold");
    assert.equal(billing.grantsPlanAccess(subscription, Date.now()), false);
    assert.equal(fixture.tables.dodoWebhookEvents!.length, 1);
  });
}

test("missing status preserves an existing active subscription without upserting", async () => {
  const fixture = testDatabase({
    billingSubscriptions: [{ ...baseline, status: "active" }],
  });
  await apply(fixture, undefined);
  assert.equal(fixture.tables.billingSubscriptions![0]!.status, "active");
  assert.equal(fixture.tables.billingSubscriptions![0]!.updatedAt, 2);
});

for (const [eventType, payload, expected] of [
  ["subscription.updated", "active", "active"],
  ["subscription.paused", "active", "on_hold"],
  ["subscription.renewed", undefined, "renewed"],
] as const) {
  test(`${eventType} retains legitimate lifecycle behaviour`, async () => {
    const fixture = testDatabase({ billingSubscriptions: [baseline] });
    await apply(fixture, payload, eventType);
    assert.equal(fixture.tables.billingSubscriptions![0]!.status, expected);
  });
}

test("duplicate and older events cannot activate a newer on-hold subscription", async () => {
  const fixture = testDatabase({ billingSubscriptions: [baseline] });
  await apply(fixture, undefined, "subscription.paused", "pause", 3000);
  assert.deepEqual(
    await apply(fixture, "active", "subscription.updated", "pause", 4000),
    { duplicate: true },
  );
  await apply(fixture, "active", "subscription.updated", "old", 2000);
  assert.equal(fixture.tables.billingSubscriptions![0]!.status, "on_hold");
  assert.equal(
    fixture.tables.billingSubscriptions![0]!.rawEventTimestamp,
    3000,
  );
});

test("cancelled subscriptions retain access only until the paid period ends", () => {
  assert.equal(
    billing.grantsPlanAccess({ status: "cancelled", accessEndsAt: 3000 }, 2000),
    true,
  );
  assert.equal(
    billing.grantsPlanAccess({ status: "cancelled", accessEndsAt: 3000 }, 3000),
    false,
  );
});
