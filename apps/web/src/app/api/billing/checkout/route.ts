import Stripe from "stripe";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type BillingInterval, type PlanKey } from "@multifeed/plans";
import {
  getBillingServerSecret,
  getStripePriceId,
  getStripeSecretKey,
} from "@/lib/billing-config";
import {
  getHexclaveConvexServerToken,
  hexclaveServerApp,
} from "@/hexclave/server";
import { appOrigin, assertSameOrigin } from "@/lib/oauth/env";
import { MANAGE_BILLING_PERMISSION } from "@/lib/team-permissions";

const responseOptions = {
  headers: { "Cache-Control": "private, no-store" },
};

const isPlanKey = (value: unknown): value is PlanKey =>
  value === "creator" || value === "growth" || value === "agency";

const isBillingInterval = (value: unknown): value is BillingInterval =>
  value === "month" || value === "year";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status, ...responseOptions });

const convexErrorStatus = (error: unknown): number | null => {
  if (!(error instanceof ConvexError)) return null;
  const code = (error.data as { code?: unknown } | undefined)?.code;
  if (code === "CONFLICT") return 409;
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "INVALID_INPUT") return 400;
  return 500;
};

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
  } catch {
    return errorResponse("Invalid request origin", 403);
  }

  const auth = await Promise.all([
    hexclaveServerApp.getUser({ tokenStore: request }),
    getHexclaveConvexServerToken(request),
    request.json().catch(() => null) as Promise<unknown>,
  ]).catch((error) => {
    console.error(
      "[billing/checkout-auth]",
      error instanceof Error ? error.message : error,
    );
    return null;
  });

  if (!auth) {
    return errorResponse("Unauthorized", 401);
  }

  const [user, token, payload] = auth;

  if (!user || !token) {
    return errorResponse("Unauthorized", 401);
  }

  const team = user.selectedTeam;
  if (!team) {
    return errorResponse("No selected team", 400);
  }

  let canManageBilling: boolean;
  try {
    canManageBilling = await user.hasPermission(
      team,
      MANAGE_BILLING_PERMISSION,
    );
  } catch (error) {
    console.error(
      "[billing/checkout-permission]",
      error instanceof Error ? error.message : error,
    );
    return errorResponse("Could not verify permissions", 502);
  }

  if (!canManageBilling) {
    return errorResponse(
      "You do not have permission to manage billing for this team",
      403,
    );
  }

  if (!user.primaryEmail) {
    return errorResponse("Billing requires a primary email", 400);
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("planKey" in payload) ||
    !isPlanKey(payload.planKey) ||
    !("interval" in payload) ||
    !isBillingInterval(payload.interval)
  ) {
    return errorResponse("Invalid plan", 400);
  }

  try {
    const entitlements = await fetchQuery(
      api.billing.getEntitlements,
      { nowMs: Date.now() },
      { token },
    );
    if (entitlements.accessSource === "super_admin") {
      return errorResponse(
        "This account already has complimentary owner access",
        409,
      );
    }
  } catch {
    return errorResponse("Could not verify account access", 503);
  }

  const priceId = getStripePriceId(payload.planKey, payload.interval);
  const secretKey = getStripeSecretKey();
  const serverSecret = getBillingServerSecret();

  if (!priceId) {
    console.error(
      `[billing/checkout] no Stripe price configured for plan=${payload.planKey} interval=${payload.interval}`,
    );
    return errorResponse("Billing is not configured", 500);
  }

  if (!secretKey || !serverSecret) {
    console.error(
      "[billing/checkout] STRIPE_SECRET_KEY or BILLING_SERVER_SECRET is missing or invalid",
    );
    return errorResponse("Billing is not configured", 500);
  }

  // Record the checkout intent first: beginCheckout serializes per team,
  // enforces canStartCheckout, and dedupes concurrent/pending checkouts.
  let intent: {
    checkoutIntentId: Id<"billingSubscriptions">;
    checkoutUrl?: string;
    stripeCustomerId?: string;
    userId: string;
    teamId: string;
    checkoutExpiresAt: number;
  };
  try {
    intent = await fetchMutation(
      api.billing.beginCheckout,
      {
        planKey: payload.planKey,
        interval: payload.interval,
        stripePriceId: priceId,
        serverSecret,
        expectedTeamId: team.id,
      },
      { token },
    );
  } catch (error) {
    const status = convexErrorStatus(error);
    if (status !== null && error instanceof ConvexError) {
      const message = (error.data as { message?: unknown } | undefined)
        ?.message;
      return errorResponse(
        typeof message === "string" ? message : "Checkout conflict",
        status,
      );
    }
    console.error(
      "[billing/begin-checkout]",
      error instanceof Error ? error.message : error,
    );
    return errorResponse("Could not start checkout", 503);
  }

  // A pending checkout for the same plan already has a URL — resume it
  // instead of creating a second Stripe session.
  if (intent.checkoutUrl) {
    return NextResponse.json(
      { checkoutUrl: intent.checkoutUrl },
      responseOptions,
    );
  }

  const origin = appOrigin();
  const client = new Stripe(secretKey, { maxNetworkRetries: 2 });
  const metadata = {
    teamId: intent.teamId,
    orgId: intent.teamId,
    userId: intent.userId,
    planKey: payload.planKey,
    interval: payload.interval,
    checkoutIntentId: intent.checkoutIntentId,
  };

  let session: Stripe.Checkout.Session;
  let customerId = intent.stripeCustomerId;
  if (intent.checkoutExpiresAt < Date.now() + 31 * 60 * 1000) {
    return errorResponse(
      "This checkout is expiring. Please try again after it expires",
      409,
    );
  }
  try {
    if (!customerId) {
      const customer = await client.customers.create(
        { metadata: { teamId: intent.teamId, orgId: intent.teamId } },
        { idempotencyKey: `billing-customer:${intent.teamId}` },
      );
      customerId = customer.id;
    }

    await fetchMutation(
      api.billing.rememberStripeCustomer,
      {
        checkoutIntentId: intent.checkoutIntentId,
        stripeCustomerId: customerId,
        serverSecret,
      },
      { token },
    );

    session = await client.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        customer: customerId,
        client_reference_id: intent.teamId,
        expires_at: Math.floor(intent.checkoutExpiresAt / 1000),
        metadata,
        subscription_data: { metadata },
        success_url: `${origin}/billing?checkout=complete`,
        cancel_url: `${origin}/billing?checkout=cancelled`,
      },
      { idempotencyKey: `billing-checkout:${intent.checkoutIntentId}` },
    );
  } catch (error) {
    console.error(
      "[billing/checkout]",
      error instanceof Error ? error.message : error,
    );
    // A timeout can happen after Stripe creates the session. Preserve this
    // intent so retries use the same idempotency key and cannot double bill.
    if (
      error instanceof Stripe.errors.StripeInvalidRequestError &&
      error.code !== "idempotency_key_in_use" &&
      error.code !== "lock_timeout"
    ) {
      await fetchMutation(
        api.billing.abandonCheckout,
        {
          checkoutIntentId: intent.checkoutIntentId,
          serverSecret,
        },
        { token },
      ).catch(() => {
        console.error(
          "[billing/checkout] could not clear rejected checkout intent",
        );
      });
    }
    return errorResponse("Could not start checkout", 502);
  }

  if (!session.url) {
    return errorResponse("Stripe did not return a checkout URL", 502);
  }

  try {
    await fetchMutation(
      api.billing.completeCheckout,
      {
        checkoutIntentId: intent.checkoutIntentId,
        checkoutSessionId: session.id,
        checkoutUrl: session.url,
        checkoutExpiresAt: session.expires_at * 1000,
        stripeCustomerId: customerId,
        serverSecret,
      },
      { token },
    );
  } catch (error) {
    console.error(
      "[billing/complete-checkout]",
      error instanceof Error ? error.message : error,
    );
    return errorResponse("Could not save checkout. Please try again", 503);
  }

  return NextResponse.json({ checkoutUrl: session.url }, responseOptions);
}
