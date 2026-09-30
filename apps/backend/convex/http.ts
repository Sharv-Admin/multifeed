import { registerRoutes } from "@convex-dev/stripe";
import { httpRouter } from "convex/server";
import type Stripe from "stripe";
import { components, internal } from "./_generated/api";

const http = httpRouter();

function stripeObjectId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (subscription) return stripeObjectId(subscription);

  // Events retain the API version configured on the Stripe destination.
  const legacyInvoice = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  return stripeObjectId(legacyInvoice.subscription);
}

registerRoutes(http, components.stripe, {
  webhookPath: "/stripe/webhook",
  apiVersion: "2026-08-26.dahlia",
  onEvent: async (ctx, event) => {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        await ctx.runAction(internal.billingWebhook.syncEvent, {
          eventId: event.id,
          eventType: event.type,
          subscriptionId: event.data.object.id,
        });
        break;
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = stripeObjectId(subscription.customer);
        await ctx.runAction(internal.billingWebhook.syncEvent, {
          eventId: event.id,
          eventType: event.type,
          subscriptionId: subscription.id,
          deletedSubscription: customerId
            ? {
                customerId,
                teamId: subscription.metadata.teamId,
                userId: subscription.metadata.userId,
                checkoutIntentId: subscription.metadata.checkoutIntentId,
              }
            : undefined,
        });
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const subscriptionId = invoiceSubscriptionId(event.data.object);
        if (subscriptionId) {
          await ctx.runAction(internal.billingWebhook.syncEvent, {
            eventId: event.id,
            eventType: event.type,
            subscriptionId,
          });
        }
        break;
      }
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        await ctx.runAction(internal.billingWebhook.syncEvent, {
          eventId: event.id,
          eventType: event.type,
          checkoutSessionId: event.data.object.id,
        });
        break;
    }
  },
});

export default http;
