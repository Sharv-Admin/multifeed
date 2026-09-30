import {
  PLAN_KEYS,
  type BillingInterval,
  type PlanKey,
} from "@multifeed/plans";
import { fail } from "./errors";

const priceEnvNames: Record<PlanKey, Record<BillingInterval, string>> = {
  creator: {
    month: "STRIPE_CREATOR_MONTHLY_PRICE_ID",
    year: "STRIPE_CREATOR_YEARLY_PRICE_ID",
  },
  growth: {
    month: "STRIPE_GROWTH_MONTHLY_PRICE_ID",
    year: "STRIPE_GROWTH_YEARLY_PRICE_ID",
  },
  agency: {
    month: "STRIPE_AGENCY_MONTHLY_PRICE_ID",
    year: "STRIPE_AGENCY_YEARLY_PRICE_ID",
  },
};

export const getStripePriceId = (planKey: PlanKey, interval: BillingInterval) =>
  process.env[priceEnvNames[planKey][interval]]?.trim() || undefined;

export function getStripePlan(priceId: string) {
  const matches = PLAN_KEYS.flatMap((planKey) =>
    (["month", "year"] as const).flatMap((interval) =>
      getStripePriceId(planKey, interval) === priceId
        ? [{ planKey, interval }]
        : [],
    ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Billing writes are only reachable through the permission-checked web server. */
export function requireBillingServer(provided: string) {
  const expected = process.env.BILLING_SERVER_SECRET;
  if (!expected || expected.length < 32) {
    fail("INTERNAL_ERROR", "Billing server is not configured");
  }
  if (provided.length !== expected.length) {
    fail("FORBIDDEN", "Unauthorized billing server request");
  }
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (mismatch !== 0) {
    fail("FORBIDDEN", "Unauthorized billing server request");
  }
}
