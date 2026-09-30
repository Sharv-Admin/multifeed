import { v } from "convex/values";
import { getPlanLimits } from "@multifeed/plans";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  getStripePlan,
  getStripePriceId,
  requireBillingServer,
} from "./billingConfig";
import { fail } from "./errors";
import { requireUser } from "./hexclave/auth";
import {
  billingInterval,
  billingStatus,
  stripeBillingStatus,
  planKey as planKeyValidator,
} from "./schema";
import { serializeScope } from "./writeGuards";
import { hasSuperAdminAccess } from "./superAdminAccess";

export const ACTIVE_BILLING = new Set([
  "active",
  "trialing",
  "renewed",
  "updated",
  "plan_changed",
]);

const STATUSES = [
  "pending",
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
  "renewed",
  "updated",
  "plan_changed",
  "cancelled",
  "on_hold",
  "failed",
  "expired",
] as const;

// Stripe expiry is fixed when the intent is created, including delayed retries.
const PENDING_CHECKOUT_TTL_MS = 23 * 60 * 60 * 1000;

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
    teamId: v.string(),
    planKey: planKeyValidator,
    interval: billingInterval,
    status: billingStatus,
    billingProvider: v.union(v.literal("stripe"), v.literal("dodo")),
    hasPlanAccess: v.boolean(),
    canStartCheckout: v.boolean(),
    stripeCustomerId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    accessEndsAt: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    updatedAt: v.number(),
  }),
  v.null(),
);

export function grantsPlanAccess(
  sub: Pick<
    Doc<"billingSubscriptions">,
    | "status"
    | "accessEndsAt"
    | "billingProvider"
    | "stripeSubscriptionId"
    | "currentPeriodEnd"
    | "planVerified"
    | "paymentVerified"
  >,
  now: number,
) {
  if (sub.billingProvider === "stripe" || sub.stripeSubscriptionId) {
    return (
      sub.planVerified === true &&
      sub.paymentVerified === true &&
      sub.currentPeriodEnd !== undefined &&
      sub.currentPeriodEnd > now &&
      (sub.status === "active" || sub.status === "trialing") &&
      (sub.accessEndsAt === undefined || sub.accessEndsAt > now)
    );
  }
  // Honor legacy subscriptions through their known paid period at cutover.
  const end = sub.accessEndsAt ?? sub.currentPeriodEnd;
  return (
    (ACTIVE_BILLING.has(sub.status) || sub.status === "cancelled") &&
    end !== undefined &&
    end > now
  );
}

export function canStartCheckout(
  sub: Doc<"billingSubscriptions">,
  now: number,
) {
  if (sub.billingProvider === "stripe" || sub.stripeSubscriptionId) {
    return sub.status === "canceled" || sub.status === "incomplete_expired";
  }
  return !grantsPlanAccess(sub, now);
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
      .flatMap((row) =>
        row &&
        (row.stripeSubscriptionId || row.dodoSubscriptionId) &&
        row.status !== "pending"
          ? [row]
          : [],
      )
      .sort(
        (a, b) =>
          Number(!canStartCheckout(b, now)) -
            Number(!canStartCheckout(a, now)) ||
          Number(grantsPlanAccess(b, now)) - Number(grantsPlanAccess(a, now)) ||
          b.updatedAt - a.updatedAt,
      )[0] ?? null
  );
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
  const plan = sub && grantsPlanAccess(sub, now) ? sub.planKey : null;
  const limits = getPlanLimits(plan);
  return {
    accessSource: plan ? ("subscription" as const) : ("free" as const),
    planKey: plan,
    hasActivePlan: plan !== null,
    connectedAccountLimit: limits.connectedAccounts,
    teamSeatLimit: limits.teamSeats,
  };
}

export const getEntitlements = query({
  args: { nowMs: v.number() },
  returns: entitlementValidator,
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await entitlementsForTeam(ctx, user.selectedTeamId, Date.now());
  },
});

export const getSubscription = query({
  args: { nowMs: v.number() },
  returns: subscriptionSnapshotValidator,
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const sub = await latestForTeam(ctx, user.selectedTeamId, now);
    return sub
      ? {
          teamId: sub.teamId,
          planKey: sub.planKey,
          interval: sub.interval,
          status: sub.status,
          billingProvider: sub.stripeSubscriptionId
            ? ("stripe" as const)
            : ("dodo" as const),
          hasPlanAccess: grantsPlanAccess(sub, now),
          canStartCheckout: canStartCheckout(sub, now),
          stripeCustomerId: sub.stripeCustomerId,
          currentPeriodEnd: sub.currentPeriodEnd,
          accessEndsAt: sub.accessEndsAt,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          updatedAt: sub.updatedAt,
        }
      : null;
  },
});

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

async function rememberCustomer(
  ctx: MutationCtx,
  teamId: string,
  stripeCustomerId: string,
) {
  const [teamCustomer, customerTeam] = await Promise.all([
    ctx.db
      .query("billingCustomers")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .first(),
    ctx.db
      .query("billingCustomers")
      .withIndex("by_stripe_customer", (q) =>
        q.eq("stripeCustomerId", stripeCustomerId),
      )
      .first(),
  ]);
  if (
    (teamCustomer && teamCustomer.stripeCustomerId !== stripeCustomerId) ||
    (customerTeam && customerTeam.teamId !== teamId)
  ) {
    fail("CONFLICT", "Stripe customer does not belong to this team");
  }
  if (!teamCustomer) {
    await ctx.db.insert("billingCustomers", {
      teamId,
      stripeCustomerId,
      createdAt: Date.now(),
    });
  }
}

export const beginCheckout = mutation({
  args: {
    planKey: planKeyValidator,
    interval: billingInterval,
    stripePriceId: v.string(),
    serverSecret: v.string(),
    expectedTeamId: v.string(),
  },
  returns: v.object({
    checkoutIntentId: v.id("billingSubscriptions"),
    checkoutUrl: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    userId: v.string(),
    teamId: v.string(),
    checkoutExpiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    requireBillingServer(args.serverSecret);
    const user = await requireUser(ctx);
    if (args.expectedTeamId !== user.selectedTeamId) {
      fail("CONFLICT", "The selected team changed. Refresh and try again");
    }
    if (hasSuperAdminAccess(user, user.selectedTeamId)) {
      fail("CONFLICT", "This account already has complimentary owner access");
    }
    const now = Date.now();
    const price = getStripePlan(args.stripePriceId);
    if (
      getStripePriceId(args.planKey, args.interval) !== args.stripePriceId ||
      price?.planKey !== args.planKey ||
      price.interval !== args.interval
    ) {
      fail("INVALID_INPUT", "Invalid Stripe plan price");
    }
    await serializeScope(ctx, `billing-checkout:${user.selectedTeamId}`);
    const sub = await latestForTeam(ctx, user.selectedTeamId, now);
    if (sub && !canStartCheckout(sub, now)) {
      fail(
        "CONFLICT",
        "Manage the existing subscription before starting a new checkout",
      );
    }
    const customer = await ctx.db
      .query("billingCustomers")
      .withIndex("by_team", (q) => q.eq("teamId", user.selectedTeamId))
      .first();
    const pending = await latestPendingCheckout(ctx, user.selectedTeamId);
    if (
      pending &&
      now <
        (pending.checkoutExpiresAt ??
          pending.createdAt + PENDING_CHECKOUT_TTL_MS)
    ) {
      if (
        pending.billingProvider === "stripe" &&
        pending.planKey === args.planKey &&
        pending.interval === args.interval &&
        pending.stripePriceId === args.stripePriceId
      ) {
        return {
          checkoutIntentId: pending._id,
          checkoutUrl: pending.stripeCheckoutUrl,
          stripeCustomerId:
            pending.stripeCustomerId ?? customer?.stripeCustomerId,
          userId: pending.userId,
          teamId: pending.teamId,
          checkoutExpiresAt:
            pending.checkoutExpiresAt ??
            Math.floor(pending.createdAt / 1000) * 1000 +
              PENDING_CHECKOUT_TTL_MS,
        };
      }
      fail("CONFLICT", "A checkout is already in progress for this team");
    }
    if (pending) {
      await ctx.db.patch("billingSubscriptions", pending._id, {
        status: "expired",
        updatedAt: now,
      });
    }
    const checkoutExpiresAt =
      Math.floor(now / 1000) * 1000 + PENDING_CHECKOUT_TTL_MS;
    const checkoutIntentId = await ctx.db.insert("billingSubscriptions", {
      teamId: user.selectedTeamId,
      userId: user.id,
      planKey: args.planKey,
      interval: args.interval,
      status: "pending",
      billingProvider: "stripe",
      stripePriceId: args.stripePriceId,
      stripeCustomerId: customer?.stripeCustomerId,
      checkoutExpiresAt,
      createdAt: now,
      updatedAt: now,
    });
    return {
      checkoutIntentId,
      stripeCustomerId: customer?.stripeCustomerId,
      userId: user.id,
      teamId: user.selectedTeamId,
      checkoutExpiresAt,
    };
  },
});

export const rememberStripeCustomer = mutation({
  args: {
    checkoutIntentId: v.id("billingSubscriptions"),
    stripeCustomerId: v.string(),
    serverSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireBillingServer(args.serverSecret);
    const user = await requireUser(ctx);
    const intent = await ctx.db.get(
      "billingSubscriptions",
      args.checkoutIntentId,
    );
    if (
      !intent ||
      intent.teamId !== user.selectedTeamId ||
      intent.billingProvider !== "stripe"
    ) {
      fail("FORBIDDEN", "Checkout does not belong to this team");
    }
    await serializeScope(ctx, `billing-checkout:${intent.teamId}`);
    await rememberCustomer(ctx, intent.teamId, args.stripeCustomerId);
    await ctx.db.patch("billingSubscriptions", intent._id, {
      stripeCustomerId: args.stripeCustomerId,
    });
    return null;
  },
});

export const completeCheckout = mutation({
  args: {
    checkoutIntentId: v.id("billingSubscriptions"),
    checkoutSessionId: v.string(),
    checkoutUrl: v.string(),
    checkoutExpiresAt: v.number(),
    stripeCustomerId: v.string(),
    serverSecret: v.string(),
  },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    requireBillingServer(args.serverSecret);
    const user = await requireUser(ctx);
    await serializeScope(ctx, `billing-checkout:${user.selectedTeamId}`);
    const intent = await ctx.db.get(
      "billingSubscriptions",
      args.checkoutIntentId,
    );
    if (
      !intent ||
      intent.teamId !== user.selectedTeamId ||
      intent.billingProvider !== "stripe"
    ) {
      fail("FORBIDDEN", "Checkout does not belong to this team");
    }
    if (
      (intent.stripeCheckoutSessionId &&
        intent.stripeCheckoutSessionId !== args.checkoutSessionId) ||
      !Number.isFinite(args.checkoutExpiresAt)
    ) {
      fail("CONFLICT", "Checkout session does not match the existing intent");
    }
    await rememberCustomer(ctx, intent.teamId, args.stripeCustomerId);
    await ctx.db.patch("billingSubscriptions", intent._id, {
      stripeCheckoutSessionId: args.checkoutSessionId,
      stripeCheckoutUrl: args.checkoutUrl,
      stripeCustomerId: args.stripeCustomerId,
      checkoutExpiresAt: args.checkoutExpiresAt,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

export const abandonCheckout = mutation({
  args: {
    checkoutIntentId: v.id("billingSubscriptions"),
    serverSecret: v.string(),
  },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    requireBillingServer(args.serverSecret);
    const user = await requireUser(ctx);
    await serializeScope(ctx, `billing-checkout:${user.selectedTeamId}`);
    const intent = await ctx.db.get(
      "billingSubscriptions",
      args.checkoutIntentId,
    );
    if (!intent || intent.teamId !== user.selectedTeamId) {
      fail("FORBIDDEN", "Checkout does not belong to this team");
    }
    if (intent.status === "pending" && !intent.stripeCheckoutSessionId) {
      await ctx.db.patch("billingSubscriptions", intent._id, {
        status: "expired",
        updatedAt: Date.now(),
      });
    }
    return { ok: true as const };
  },
});

async function alreadyProcessed(ctx: MutationCtx, eventId: string) {
  return await ctx.db
    .query("stripeWebhookEvents")
    .withIndex("by_event_id", (q) => q.eq("eventId", eventId))
    .first();
}

export const syncStripeSubscription = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    subscriptionId: v.string(),
    customerId: v.string(),
    teamId: v.optional(v.string()),
    userId: v.optional(v.string()),
    checkoutIntentId: v.optional(v.string()),
    stripePriceId: v.string(),
    status: stripeBillingStatus,
    interval: v.optional(billingInterval),
    planKey: v.optional(planKeyValidator),
    currentPeriodEnd: v.optional(v.number()),
    cancelAt: v.optional(v.number()),
    cancelAtPeriodEnd: v.boolean(),
    paymentVerified: v.boolean(),
    observedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await alreadyProcessed(ctx, args.eventId)) return null;
    const now = Date.now();
    let existing = await ctx.db
      .query("billingSubscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", args.subscriptionId),
      )
      .first();
    if (!existing && args.checkoutIntentId) {
      const intentId = ctx.db.normalizeId(
        "billingSubscriptions",
        args.checkoutIntentId,
      );
      const intent = intentId
        ? await ctx.db.get("billingSubscriptions", intentId)
        : null;
      if (
        intent?.billingProvider === "stripe" &&
        (!intent.stripeSubscriptionId ||
          intent.stripeSubscriptionId === args.subscriptionId)
      )
        existing = intent;
    }
    const teamId = existing?.teamId ?? args.teamId;
    const userId = existing?.userId ?? args.userId;
    const configuredPlan = getStripePlan(args.stripePriceId);
    const planVerified =
      configuredPlan !== undefined &&
      configuredPlan.planKey === args.planKey &&
      configuredPlan.interval === args.interval;
    const planKey = planVerified ? configuredPlan.planKey : existing?.planKey;
    const interval = planVerified
      ? configuredPlan.interval
      : existing?.interval;
    const ownershipMatches =
      existing === null ||
      existing.stripeSubscriptionId === args.subscriptionId ||
      ((!args.teamId || args.teamId === existing.teamId) &&
        (!args.userId || args.userId === existing.userId) &&
        (!existing.stripeCustomerId ||
          existing.stripeCustomerId === args.customerId));
    if (
      teamId &&
      userId &&
      planKey &&
      interval &&
      ownershipMatches &&
      (!existing?.lastSyncedAt || args.observedAt >= existing.lastSyncedAt)
    ) {
      await serializeScope(ctx, `billing-checkout:${teamId}`);
      await rememberCustomer(ctx, teamId, args.customerId);
      const record = {
        teamId,
        userId,
        planKey,
        interval,
        billingProvider: "stripe" as const,
        stripeSubscriptionId: args.subscriptionId,
        stripeCustomerId: args.customerId,
        stripePriceId: args.stripePriceId,
        status: args.status,
        planVerified,
        paymentVerified: args.paymentVerified,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
        accessEndsAt:
          args.cancelAt ??
          (args.cancelAtPeriodEnd ? args.currentPeriodEnd : undefined),
        lastSyncedAt: args.observedAt,
        updatedAt: now,
      };
      if (existing)
        await ctx.db.patch("billingSubscriptions", existing._id, record);
      else
        await ctx.db.insert("billingSubscriptions", {
          ...record,
          createdAt: now,
        });
    }
    await ctx.db.insert("stripeWebhookEvents", {
      eventId: args.eventId,
      eventType: args.eventType,
      subscriptionId: args.subscriptionId,
      processedAt: now,
    });
    return null;
  },
});

export const expireStripeCheckout = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    checkoutIntentId: v.string(),
    checkoutSessionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await alreadyProcessed(ctx, args.eventId)) return null;
    const intentId = ctx.db.normalizeId(
      "billingSubscriptions",
      args.checkoutIntentId,
    );
    const intent = intentId
      ? await ctx.db.get("billingSubscriptions", intentId)
      : null;
    if (
      intent?.billingProvider === "stripe" &&
      intent.status === "pending" &&
      (!intent.stripeCheckoutSessionId ||
        intent.stripeCheckoutSessionId === args.checkoutSessionId)
    ) {
      await serializeScope(ctx, `billing-checkout:${intent.teamId}`);
      await ctx.db.patch("billingSubscriptions", intent._id, {
        status: "expired",
        updatedAt: Date.now(),
      });
    }
    await ctx.db.insert("stripeWebhookEvents", {
      eventId: args.eventId,
      eventType: args.eventType,
      processedAt: Date.now(),
    });
    return null;
  },
});
