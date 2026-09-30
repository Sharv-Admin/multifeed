import Stripe from "stripe";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { api } from "@convex/_generated/api";
import { getStripeSecretKey } from "@/lib/billing-config";
import {
  getHexclaveConvexServerToken,
  hexclaveServerApp,
} from "@/hexclave/server";
import { appOrigin, assertSameOrigin } from "@/lib/oauth/env";
import { MANAGE_BILLING_PERMISSION } from "@/lib/team-permissions";

const responseOptions = {
  headers: { "Cache-Control": "private, no-store" },
};

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status, ...responseOptions });

const fetchCurrentSubscription = (token: string) =>
  fetchQuery(api.billing.getSubscription, { nowMs: Date.now() }, { token });

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
  } catch {
    return errorResponse("Invalid request origin", 403);
  }

  const auth = await Promise.all([
    hexclaveServerApp.getUser({ tokenStore: request }),
    getHexclaveConvexServerToken(request),
  ]).catch((error) => {
    console.error(
      "[billing/portal-auth]",
      error instanceof Error ? error.message : error,
    );
    return null;
  });

  if (!auth) {
    return errorResponse("Unauthorized", 401);
  }

  const [user, token] = auth;

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
      "[billing/portal-permission]",
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

  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    console.error("[billing/portal] STRIPE_SECRET_KEY is missing or invalid");
    return errorResponse("Billing is not configured", 500);
  }

  let subscription: Awaited<ReturnType<typeof fetchCurrentSubscription>>;
  try {
    subscription = await fetchCurrentSubscription(token);
  } catch (error) {
    console.error(
      "[billing/portal-check]",
      error instanceof Error ? error.message : error,
    );
    return errorResponse("Could not verify subscription status", 503);
  }

  if (subscription && subscription.teamId !== team.id) {
    return errorResponse(
      "The selected team changed. Refresh and try again",
      409,
    );
  }

  if (
    subscription?.billingProvider !== "stripe" ||
    !subscription.stripeCustomerId
  ) {
    return errorResponse("No active customer billing portal found", 404);
  }

  const origin = appOrigin();
  const client = new Stripe(secretKey, { maxNetworkRetries: 2 });

  try {
    const portalSession = await client.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${origin}/billing`,
    });

    if (!portalSession.url) {
      return errorResponse("Stripe did not return a portal link", 502);
    }

    return NextResponse.json({ url: portalSession.url }, responseOptions);
  } catch (error) {
    console.error(
      "[billing/portal]",
      error instanceof Error ? error.message : error,
    );
    return errorResponse("Could not open billing portal", 502);
  }
}
