import { v } from "convex/values";
import { getPlanLimits, type PlanKey } from "@multifeed/plans";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { fail } from "./errors";
import { requireUser } from "./hexclave/auth";
import {
  billingInterval,
  billingStatus,
  planKey as planKeyValidator,
} from "./schema";
import { serializeScope } from "./writeGuards";
import { hasSuperAdminAccess } from "./superAdminAccess";

/** Subscription statuses that grant product access. */
export const ACTIVE_BILLING = new Set([
  "active",
  "renewed",
  "updated",
  "plan_changed",
]);

const STATUSES = [
  "pending",
  "active",
  "renewed",
  "updated",
  "plan_changed",
  "cancelled",
  "on_hold",
  "failed",
  "expired",
] as const;

type BillingStatus = (typeof STATUSES)[number];

/**
 * Lifecycle events whose type alone determines the resulting status. The
 * payload's `status` field is deliberately ignored for these — the event type
 * is the authoritative signal.
 *
 * Dodo emits `subscription.paused`/`unpaused`; the schema has no `paused`
 * literal, so paused maps to `on_hold` (also non-entitled and recoverable).
 */
const EVENT_STATUS: Record<string, BillingStatus> = {
  "subscription.active": "active",
  "subscription.renewed": "renewed",
  "subscription.plan_changed": "plan_changed",
  "subscription.cancelled": "cancelled",
  "subscription.on_hold": "on_hold",
  "subscription.paused": "on_hold",
  "subscription.failed": "failed",
  "subscription.expired": "expired",
};

/**
 * Generic sync events — fired on any field change — where the payload's
 * `status` describes the subscription's actual state.
 */
const SYNC_EVENTS = new Set([
  "subscription.updated",
  "subscription.unpaused",
  "subscription.update_payment_method",
]);

/** How long a checkout intent may sit pending before it stops blocking. */
const PENDING_CHECKOUT_TTL_MS = 30 * 60 * 1000;

export const entitlementValidator = v.object({
  accessSource: v.union(
    v.literal("super_admin"),
    v.literal("subscription"),
    v.literal("free"),
  ),
  planKey: v.union(planKeyValidator, v.null()),
  hasActivePlan: v.boolean(),
  connectedAccountLimit: v.number(),
  teamSeatLimit: v.number(),
});

const subscriptionSnapshotValidator = v.union(
  v.object({
    planKey: planKeyValidator,
    interval: billingInterval,
    status: billingStatus,
    hasPlanAccess: v.boolean(),
    canStartCheckout: v.boolean(),
    dodoCustomerId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    accessEndsAt: v.optional(v.number()),
    updatedAt: v.number(),
  }),
  v.null(),
);

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function parseTime(value: unknown): number | undefined {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value > 1e11 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const num = Number(value);
    if (!Number.isNaN(num) && value.trim() !== "") {
      return num > 1e11 ? num : num * 1000;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function asPlan(value: unknown): PlanKey | undefined {
  return value === "creator" || value === "growth" || value === "agency"
    ? value
    : undefined;
}

function asInterval(value: unknown) {
  return value === "month" || value === "year" ? value : undefined;
}

function webhookStatus(
  eventType: string,
  event: Record<string, unknown>,
): BillingStatus | undefined {
  const mapped = EVENT_STATUS[eventType];
  if (mapped) return mapped;

  if (SYNC_EVENTS.has(eventType)) {
    // Only generic sync events consult the payload status, and only when it is
    // a status we actually model.
    const rawStatus = firstNonEmptyString(event.status);
    if (rawStatus && (STATUSES as readonly string[]).includes(rawStatus)) {
      return rawStatus as BillingStatus;
    }
    return "updated";
  }

  return undefined;
}

export function grantsPlanAccess(
  sub: Pick<Doc<"billingSubscriptions">, "status" | "accessEndsAt">,
  now: number,
) {
  return (
    ACTIVE_BILLING.has(sub.status) ||
    (sub.status === "cancelled" &&
      sub.accessEndsAt !== undefined &&
      sub.accessEndsAt > now)
  );
}

/**
 * Only terminal or suspended subscriptions may be replaced with a new checkout.
 * `on_hold` (failed renewal) grants no access, so a fresh checkout is allowed.
 */
export function canStartCheckout(
  sub: Pick<Doc<"billingSubscriptions">, "status" | "accessEndsAt">,
  now: number,
) {
  return (
    sub.status === "failed" ||
    sub.status === "expired" ||
    sub.status === "on_hold" ||
    (sub.status === "cancelled" && !grantsPlanAccess(sub, now))
  );
}

function statusRank(sub: Doc<"billingSubscriptions">, now: number) {
  return grantsPlanAccess(sub, now) ? 1 : 0;
}

export async function latestForTeam(
  ctx: QueryCtx | MutationCtx,
  teamId: string,
  now: number,
) {
  const rows = await Promise.all(
    STATUSES.map((status) =>
      ctx.db
        .query("billingSubscriptions")
        .withIndex("by_team_status_updated", (q) =>
          q.eq("teamId", teamId).eq("status", status),
        )
        .order("desc")
        .first(),
    ),
  );

  return (
    rows
      // Local checkout intent is never subscription truth.
      .flatMap((row) =>
        row?.dodoSubscriptionId && row.status !== "pending" ? [row] : [],
      )
      .sort(
        (a, b) =>
          statusRank(b, now) - statusRank(a, now) || b.updatedAt - a.updatedAt,
      )[0] ?? null
  );
}

function snapshot(sub: Doc<"billingSubscriptions">, now: number) {
  return {
    planKey: sub.planKey,
    interval: sub.interval,
    status: sub.status,
    hasPlanAccess: grantsPlanAccess(sub, now),
    canStartCheckout: canStartCheckout(sub, now),
    dodoCustomerId: sub.dodoCustomerId,
    currentPeriodEnd: sub.currentPeriodEnd,
    accessEndsAt: sub.accessEndsAt,
    updatedAt: sub.updatedAt,
  };
}

export async function entitlementsForTeam(
  ctx: QueryCtx | MutationCtx,
  teamId: string,
  now: number,
) {
  const user = await requireUser(ctx);
  if (hasSuperAdminAccess(user, teamId)) {
    const limits = getPlanLimits("agency");
    return {
      accessSource: "super_admin" as const,
      planKey: "agency" as const,
      hasActivePlan: true,
      connectedAccountLimit: limits.connectedAccounts,
      teamSeatLimit: limits.teamSeats,
    };
  }

  const sub = await latestForTeam(ctx, teamId, now);
  const plan =
    sub && grantsPlanAccess(sub, now) ? asPlan(sub.planKey) : undefined;
  const limits = getPlanLimits(plan ?? null);

  return {
    accessSource: plan ? ("subscription" as const) : ("free" as const),
    planKey: plan ?? null,
    hasActivePlan: plan !== undefined,
    connectedAccountLimit: limits.connectedAccounts,
    teamSeatLimit: limits.teamSeats,
  };
}

/** Current plan limits for the authenticated team. */
export const getEntitlements = query({
  args: { nowMs: v.number() },
  returns: entitlementValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await entitlementsForTeam(ctx, user.selectedTeamId, args.nowMs);
  },
});

/** Current team subscription snapshot (or null). */
export const getSubscription = query({
  args: { nowMs: v.number() },
  returns: subscriptionSnapshotValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const sub = await latestForTeam(ctx, user.selectedTeamId, args.nowMs);
    return sub ? snapshot(sub, args.nowMs) : null;
  },
});

/**
 * Latest local checkout intent (status `pending`) for a team. These rows are
 * never subscription truth — `latestForTeam` ignores them — they only record
 * that a checkout was initiated so webhooks can be tied back to it.
 */
async function latestPendingCheckout(
  ctx: QueryCtx | MutationCtx,
  teamId: string,
) {
  return await ctx.db
    .query("billingSubscriptions")
    .withIndex("by_team_status_updated", (q) =>
      q.eq("teamId", teamId).eq("status", "pending"),
    )
    .order("desc")
    .first();
}

/**
 * Record checkout intent before creating a Dodo session. Must be called by the
 * Next.js checkout route BEFORE `checkoutSessions.create`:
 *
 *   1. `beginCheckout` — fails CONFLICT if a non-terminal subscription or a
 *      fresh pending checkout exists. Resumes (returns the stored URL) when the
 *      pending intent already has a checkout URL for the same plan.
 *   2. Create the Dodo checkout session.
 *   3. `completeCheckout` — stamps `dodoCheckoutSessionId`/`dodoCheckoutUrl`
 *      onto the intent row (or pass them directly to `beginCheckout` if the
 *      session already exists).
 *   4. On Dodo failure, `abandonCheckout` clears the intent so the team is not
 *      blocked for the pending TTL.
 */
export const beginCheckout = mutation({
  args: {
    planKey: planKeyValidator,
    interval: billingInterval,
    dodoProductId: v.string(),
    checkoutSessionId: v.optional(v.string()),
    checkoutUrl: v.optional(v.string()),
  },
  returns: v.object({
    checkoutIntentId: v.id("billingSubscriptions"),
    checkoutUrl: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (hasSuperAdminAccess(user, user.selectedTeamId)) {
      fail("CONFLICT", "This account already has complimentary owner access");
    }
    const now = Date.now();
    await serializeScope(ctx, `billing-checkout:${user.selectedTeamId}`);

    const sub = await latestForTeam(ctx, user.selectedTeamId, now);
    if (sub && !canStartCheckout(sub, now)) {
      fail(
        "CONFLICT",
        "An existing subscription must be managed before starting a new checkout",
      );
    }

    const pending = await latestPendingCheckout(ctx, user.selectedTeamId);
    if (pending && now - pending.updatedAt < PENDING_CHECKOUT_TTL_MS) {
      if (
        pending.dodoCheckoutUrl &&
        pending.planKey === args.planKey &&
        pending.interval === args.interval
      ) {
        // Same checkout already has a URL — let the client resume it rather
        // than spawning a second Dodo session.
        return {
          checkoutIntentId: pending._id,
          checkoutUrl: pending.dodoCheckoutUrl,
        };
      }
      fail("CONFLICT", "A checkout is already in progress for this team");
    }

    // A stale pending intent is checkout litter, not subscription truth —
    // expire it so it cannot be confused with a real subscription later.
    if (pending) {
      await ctx.db.patch("billingSubscriptions", pending._id, {
        status: "expired",
        updatedAt: now,
      });
    }

    const checkoutIntentId = await ctx.db.insert("billingSubscriptions", {
      teamId: user.selectedTeamId,
      userId: user.id,
      planKey: args.planKey,
      interval: args.interval,
      status: "pending",
      dodoProductId: args.dodoProductId,
      dodoCheckoutSessionId: args.checkoutSessionId,
      dodoCheckoutUrl: args.checkoutUrl,
      createdAt: now,
      updatedAt: now,
    });

    return { checkoutIntentId, checkoutUrl: args.checkoutUrl };
  },
});

/** Attach the created Dodo session to the team's in-flight checkout intent. */
export const completeCheckout = mutation({
  args: {
    checkoutSessionId: v.string(),
    checkoutUrl: v.string(),
  },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    await serializeScope(ctx, `billing-checkout:${user.selectedTeamId}`);

    const pending = await latestPendingCheckout(ctx, user.selectedTeamId);
    if (!pending || now - pending.updatedAt >= PENDING_CHECKOUT_TTL_MS) {
      fail("CONFLICT", "No checkout is in progress for this team");
    }

    await ctx.db.patch("billingSubscriptions", pending._id, {
      dodoCheckoutSessionId: args.checkoutSessionId,
      dodoCheckoutUrl: args.checkoutUrl,
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

/** Clear a pending intent when checkout-session creation fails or is aborted. */
export const abandonCheckout = mutation({
  args: {},
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    await serializeScope(ctx, `billing-checkout:${user.selectedTeamId}`);

    const pending = await latestPendingCheckout(ctx, user.selectedTeamId);
    if (pending) {
      await ctx.db.patch("billingSubscriptions", pending._id, {
        status: "expired",
        updatedAt: now,
      });
    }
    return { ok: true as const };
  },
});

/** Dodo webhook handler — idempotent by webhookId. */
export const handleWebhook = internalMutation({
  args: {
    webhookId: v.string(),
    eventType: v.string(),
    eventTimestamp: v.optional(v.number()),
    rawEvent: v.any(),
    data: v.any(),
  },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    await serializeScope(ctx, "billing:webhooks");
    const seen = await ctx.db
      .query("dodoWebhookEvents")
      .withIndex("by_webhook_id", (q) => q.eq("webhookId", args.webhookId))
      .first();

    if (seen) return { duplicate: true };

    const event = args.data as Record<string, unknown>;
    const status = webhookStatus(args.eventType, event);
    const subscriptionId = firstNonEmptyString(
      event.subscription_id,
      event.subscriptionId,
    );

    if (status) {
      await upsertSubscription(ctx, status, event, args.eventTimestamp);
    }

    const metadata = (event.metadata ?? {}) as Record<string, unknown>;

    await ctx.db.insert("dodoWebhookEvents", {
      webhookId: args.webhookId,
      eventType: args.eventType,
      processedAt: Date.now(),
      eventTimestamp: args.eventTimestamp,
      teamId: firstNonEmptyString(metadata.teamId),
      subscriptionId,
      rawEvent: args.rawEvent,
    });

    return { duplicate: false };
  },
});

async function upsertSubscription(
  ctx: MutationCtx,
  status: BillingStatus,
  event: Record<string, unknown>,
  rawEventTimestamp: number | undefined,
) {
  const dodoSubscriptionId = firstNonEmptyString(
    event.subscription_id,
    event.subscriptionId,
  );
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const customer = (event.customer ?? {}) as Record<string, unknown>;
  const metaTeamId = firstNonEmptyString(metadata.teamId);
  const metaUserId = firstNonEmptyString(metadata.userId);
  const metaPlan = asPlan(metadata.planKey);
  const metaInterval = asInterval(metadata.interval);
  const eventProductId = firstNonEmptyString(event.product_id, event.productId);
  const eventCustomerId = firstNonEmptyString(
    event.customer_id,
    event.customerId,
    customer.customer_id,
    customer.customerId,
  );

  let existing = dodoSubscriptionId
    ? await ctx.db
        .query("billingSubscriptions")
        .withIndex("by_subscription", (q) =>
          q.eq("dodoSubscriptionId", dodoSubscriptionId),
        )
        .first()
    : null;

  if (existing) {
    // Checkout metadata is supplied by us at session creation, but never let a
    // webhook move an existing subscription across teams, users, or customers.
    if (
      (metaTeamId !== undefined && metaTeamId !== existing.teamId) ||
      (metaUserId !== undefined && metaUserId !== existing.userId) ||
      (eventCustomerId !== undefined &&
        existing.dodoCustomerId !== undefined &&
        eventCustomerId !== existing.dodoCustomerId)
    ) {
      console.warn(
        `[billing] ignored event for subscription ${dodoSubscriptionId}: ` +
          "metadata team/user/customer does not match the stored subscription",
      );
      return null;
    }

    if (
      existing.rawEventTimestamp &&
      rawEventTimestamp &&
      rawEventTimestamp < existing.rawEventTimestamp
    ) {
      return existing._id;
    }
  }

  // A brand-new subscription: adopt the matching pending checkout intent so the
  // row written at checkout start becomes the subscription record instead of
  // leaving a duplicate pending row behind.
  if (!existing && metaTeamId && metaPlan) {
    const pending = await latestPendingCheckout(ctx, metaTeamId);
    if (
      pending &&
      pending.planKey === metaPlan &&
      (metaInterval === undefined || metaInterval === pending.interval) &&
      (metaUserId === undefined || metaUserId === pending.userId) &&
      (eventProductId === undefined || eventProductId === pending.dodoProductId)
    ) {
      existing = pending;
    }
  }

  const teamId = existing?.teamId ?? metaTeamId;
  const userId = existing?.userId ?? metaUserId;
  const plan = metaPlan ?? existing?.planKey;
  const interval = metaInterval ?? existing?.interval;
  const dodoProductId = eventProductId ?? existing?.dodoProductId;

  if (
    !dodoSubscriptionId ||
    !teamId ||
    !userId ||
    !plan ||
    !interval ||
    !dodoProductId
  ) {
    return null;
  }

  const periodEnd =
    parseTime(event.next_billing_date) ??
    parseTime(event.current_period_end) ??
    parseTime(event.expires_at) ??
    existing?.currentPeriodEnd;

  let accessEndsAt = existing?.accessEndsAt;
  if (ACTIVE_BILLING.has(status)) {
    accessEndsAt = undefined;
  } else if (status === "expired" || status === "failed") {
    accessEndsAt = Date.now();
  } else if (status === "cancelled") {
    accessEndsAt = event.cancel_at_next_billing_date
      ? periodEnd
      : (parseTime(event.cancelled_at) ?? Date.now());
  }

  const now = Date.now();
  const record = {
    teamId,
    userId,
    planKey: plan,
    interval,
    status,
    dodoSubscriptionId,
    dodoCustomerId: eventCustomerId ?? existing?.dodoCustomerId,
    dodoProductId,
    currentPeriodEnd: periodEnd,
    accessEndsAt,
    rawEventTimestamp,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch("billingSubscriptions", existing._id, record);
    return existing._id;
  }

  return await ctx.db.insert("billingSubscriptions", {
    ...record,
    createdAt: now,
  });
}
