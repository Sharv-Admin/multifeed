import DodoPayments from "dodopayments";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type BillingInterval, type PlanKey } from "@multifeed/plans";
import {
  getDodoApiKey,
  getDodoEnvironment,
  getDodoProductId,
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

  const productId = getDodoProductId(payload.planKey, payload.interval);
  const apiKey = getDodoApiKey();

  if (!productId) {
    console.error(
      `[billing/checkout] no Dodo product configured for plan=${payload.planKey} interval=${payload.interval}`,
    );
    return errorResponse("Billing is not configured", 500);
  }

  if (!apiKey) {
    console.error("[billing/checkout] DODO_PAYMENTS_API_KEY is not configured");
    return errorResponse("Billing is not configured", 500);
  }

  let environment: ReturnType<typeof getDodoEnvironment>;
  try {
    environment = getDodoEnvironment();
  } catch (error) {
    console.error(
      "[billing/checkout]",
      error instanceof Error ? error.message : error,
    );
    return errorResponse("Billing is not configured", 500);
  }

  // Record the checkout intent first: beginCheckout serializes per team,
  // enforces canStartCheckout, and dedupes concurrent/pending checkouts.
  let intent: {
    checkoutIntentId: Id<"billingSubscriptions">;
    checkoutUrl?: string;
  };
  try {
    intent = await fetchMutation(
      api.billing.beginCheckout,
      {
        planKey: payload.planKey,
        interval: payload.interval,
        dodoProductId: productId,
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
  // instead of creating a second Dodo session.
  if (intent.checkoutUrl) {
    return NextResponse.json(
      { checkoutUrl: intent.checkoutUrl },
      responseOptions,
    );
  }

  const abandonCheckout = () =>
    fetchMutation(api.billing.abandonCheckout, {}, { token }).catch(
      (error: unknown) => {
        console.error(
          "[billing/abandon-checkout]",
          error instanceof Error ? error.message : error,
        );
      },
    );

  const origin = appOrigin();
  const client = new DodoPayments({
    bearerToken: apiKey,
    environment,
  });

  let session: Awaited<ReturnType<typeof client.checkoutSessions.create>>;
  try {
    session = await client.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: {
        email: user.primaryEmail,
        name: user.displayName,
      },
      metadata: {
        teamId: team.id,
        userId: user.id,
        planKey: payload.planKey,
        interval: payload.interval,
      },
      return_url: `${origin}/billing?checkout=complete`,
      cancel_url: `${origin}/billing?checkout=cancelled`,
    });
  } catch (error) {
    console.error(
      "[billing/checkout]",
      error instanceof Error ? error.message : error,
    );
    await abandonCheckout();
    return errorResponse("Could not start checkout", 502);
  }

  if (!session.checkout_url) {
    await abandonCheckout();
    return errorResponse("Dodo did not return a checkout URL", 502);
  }

  try {
    await fetchMutation(
      api.billing.completeCheckout,
      {
        checkoutSessionId: session.session_id,
        checkoutUrl: session.checkout_url,
      },
      { token },
    );
  } catch (error) {
    console.error(
      "[billing/complete-checkout]",
      error instanceof Error ? error.message : error,
    );
  }

  return NextResponse.json(
    { checkoutUrl: session.checkout_url },
    responseOptions,
  );
}
