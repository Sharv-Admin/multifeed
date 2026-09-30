import "server-only";

import type { BillingInterval, PlanKey } from "@multifeed/plans";

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

const optionalEnv = (name: string) => process.env[name]?.trim();

export const getStripeSecretKey = () => {
  const value = optionalEnv("STRIPE_SECRET_KEY");
  return value && /^(?:sk|rk)_(?:test|live)_/.test(value) ? value : undefined;
};

export const getStripePriceId = (
  planKey: PlanKey,
  interval: BillingInterval,
) => {
  const value = optionalEnv(priceEnvNames[planKey][interval]);
  return value?.startsWith("price_") ? value : undefined;
};

export const getBillingServerSecret = () => {
  const value = optionalEnv("BILLING_SERVER_SECRET");
  return value && value.length >= 32 ? value : undefined;
};
