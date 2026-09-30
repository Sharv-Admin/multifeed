"use node";

import Stripe from "stripe";
import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { getStripePlan } from "./billingConfig";
import type { stripeBillingStatus } from "./schema";

const eventType = v.union(
  v.literal("customer.subscription.created"),
  v.literal("customer.subscription.updated"),
  v.literal("customer.subscription.deleted"),
  v.literal("customer.subscription.paused"),
  v.literal("customer.subscription.resumed"),
  v.literal("invoice.paid"),
  v.literal("invoice.payment_succeeded"),
  v.literal("invoice.payment_failed"),
  v.literal("checkout.session.completed"),
  v.literal("checkout.session.async_payment_succeeded"),
  v.literal("checkout.session.async_payment_failed"),
  v.literal("checkout.session.expired"),
);

function stripeObjectId(value: string | { id: string } | null) {
  return typeof value === "string" ? value : value?.id;
}

function milliseconds(value: number | null | undefined) {
  return value && Number.isFinite(value) && value > 0
    ? value * 1_000
    : undefined;
}

function knownSubscriptionStatus(
  status: string,
): Infer<typeof stripeBillingStatus> {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
      return "incomplete_expired";
    case "unpaid":
      return "unpaid";
    case "paused":
      return "paused";
    default:
      console.error(
        `[billing] Unrecognized Stripe subscription status: ${status}`,
      );
      return "paused";
  }
}

/** Refresh Stripe's current state so delayed webhooks cannot restore old plans. */
export const syncEvent = internalAction({
  args: {
    eventId: v.string(),
    eventType,
    subscriptionId: v.optional(v.string()),
    checkoutSessionId: v.optional(v.string()),
    deletedSubscription: v.optional(
      v.object({
        customerId: v.string(),
        teamId: v.optional(v.string()),
        userId: v.optional(v.string()),
        checkoutIntentId: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured.");
    const stripe = new Stripe(secretKey);

    let subscriptionId = args.subscriptionId;
    let checkoutMetadata: Stripe.Metadata | null = null;

    if (args.checkoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(
        args.checkoutSessionId,
      );
      if (session.mode !== "subscription") return null;

      checkoutMetadata = session.metadata;
      if (
        session.status === "expired" ||
        (args.eventType === "checkout.session.async_payment_failed" &&
          !session.subscription)
      ) {
        const checkoutIntentId = session.metadata?.checkoutIntentId;
        if (checkoutIntentId) {
          await ctx.runMutation(internal.billing.expireStripeCheckout, {
            eventId: args.eventId,
            eventType: args.eventType,
            checkoutIntentId,
            checkoutSessionId: session.id,
          });
        }
        return null;
      }

      subscriptionId = stripeObjectId(session.subscription);
      if (!subscriptionId && session.status === "complete") {
        throw new Error("Completed Stripe Checkout has no subscription.");
      }
    }

    if (!subscriptionId) return null;

    // Capture before the request: a slower older read must not overwrite a
    // subscription snapshot fetched by a newer invocation.
    const observedAt = Date.now();
    let subscription: Stripe.Subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["latest_invoice"],
      });
    } catch (error) {
      if (
        args.eventType === "customer.subscription.deleted" &&
        args.deletedSubscription &&
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === "resource_missing"
      ) {
        await ctx.runMutation(internal.billing.syncStripeSubscription, {
          eventId: args.eventId,
          eventType: args.eventType,
          subscriptionId,
          ...args.deletedSubscription,
          stripePriceId: "",
          status: "canceled",
          paymentVerified: false,
          cancelAtPeriodEnd: false,
          observedAt,
        });
        return null;
      }
      throw error;
    }

    const customerId = stripeObjectId(subscription.customer);
    if (!customerId) throw new Error("Stripe subscription has no customer.");

    const item = subscription.items.data[0];
    const mappedPlan = item ? getStripePlan(item.price.id) : undefined;
    const verifiedPlan =
      item &&
      subscription.items.data.length === 1 &&
      !subscription.items.has_more &&
      item.price.recurring?.interval === mappedPlan?.interval &&
      item.price.recurring?.interval_count === 1
        ? mappedPlan
        : undefined;
    const invoice = subscription.latest_invoice;
    // Delayed payment methods can leave a subscription active even after the
    // first payment fails, so status alone cannot establish paid access.
    const paymentVerified =
      subscription.status === "trialing" ||
      (typeof invoice !== "string" && invoice?.status === "paid");

    await ctx.runMutation(internal.billing.syncStripeSubscription, {
      eventId: args.eventId,
      eventType: args.eventType,
      subscriptionId: subscription.id,
      customerId,
      teamId: subscription.metadata.teamId || checkoutMetadata?.teamId,
      userId: subscription.metadata.userId || checkoutMetadata?.userId,
      checkoutIntentId:
        subscription.metadata.checkoutIntentId ||
        checkoutMetadata?.checkoutIntentId,
      stripePriceId: item?.price.id ?? "",
      planKey: verifiedPlan?.planKey,
      interval: verifiedPlan?.interval,
      status: knownSubscriptionStatus(subscription.status),
      paymentVerified,
      currentPeriodEnd: verifiedPlan
        ? milliseconds(item?.current_period_end)
        : undefined,
      cancelAt: milliseconds(subscription.cancel_at),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      observedAt,
    });
    return null;
  },
});
