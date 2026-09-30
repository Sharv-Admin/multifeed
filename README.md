# MultiFeed

Social scheduling app built with Next.js, Convex, Hexclave, and Turborepo.

## Apps

- `apps/web`: Next.js app (marketing, dashboard, OAuth API routes)
- `apps/backend`: Convex schema, mutations/queries, billing webhooks

## Local development

```bash
pnpm install

# Env samples (separate for web vs backend)
cp apps/web/.env.sample apps/web/.env.local
cp apps/backend/.env.sample apps/backend/.env.local
# Fill values, then set Convex deployment secrets (see below)

pnpm --filter @multifeed/backend dev
pnpm --filter @multifeed/web dev
```

## Environment variables

Samples live next to each app. OAuth server authentication and social provider credentials are shared between the two runtimes; configure each using the tables below.

| File                                                   | App     | Loaded by                               |
| ------------------------------------------------------ | ------- | --------------------------------------- |
| [`apps/web/.env.sample`](apps/web/.env.sample)         | Next.js | `.env.local` for `next dev` / deploy    |
| [`apps/backend/.env.sample`](apps/backend/.env.sample) | Convex  | CLI `.env.local` + `npx convex env set` |

### Web (`apps/web/.env.local`) — summary

| Group              | Variables                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Core**           | `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_APP_URL`                                                                |
| **Hexclave**       | `NEXT_PUBLIC_HEXCLAVE_PROJECT_ID`, `NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY`, `HEXCLAVE_SECRET_SERVER_KEY` |
| **Stripe billing** | `STRIPE_SECRET_KEY`, `STRIPE_*_PRICE_ID` (6 recurring price IDs), `BILLING_SERVER_SECRET` (shared with Convex) |
| **OAuth**          | `OAUTH_SERVER_SECRET`, `META_*`, `THREADS_*`, `LINKEDIN_*`, `GOOGLE_*`, `TIKTOK_*`, `X_*`                      |

OAuth redirect on every provider console:

```
http://localhost:3000/api/oauth/callback
```

Provider-console requirements:

| Provider  | Required setup                                                                                                                                                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facebook  | Business-type app with Facebook Login for Business; Graph API **v26.0**. Create a User access token configuration containing the requested Page permissions (`pages_manage_posts`, `pages_show_list`, `pages_read_engagement`, plus `pages_manage_engagement` for first comments) and set its ID as `META_FACEBOOK_CONFIG_ID` |
| Instagram | Instagram API with Facebook Login for Business; Graph API **v26.0**. Create a User access token configuration containing the requested `instagram_*`/Page permissions and set its ID as `META_INSTAGRAM_CONFIG_ID`                                                                                                            |
| Threads   | Threads use case with its own Threads App ID/secret; Graph **v1.0**; permissions `threads_basic`, `threads_content_publish`, `threads_manage_replies`, `threads_manage_insights`                                                                                                                                              |
| LinkedIn  | Sign In with LinkedIn using OpenID Connect plus Share on LinkedIn (`LinkedIn-Version: 202608`); programmatic refresh tokens require Marketing Developer Platform approval                                                                                                                                                     |
| YouTube   | Enable YouTube Data API v3 and YouTube Analytics API; configure the OAuth consent screen for the requested scopes                                                                                                                                                                                                             |
| TikTok    | Login Kit and Content Posting API with approved `user.info.basic`, `user.info.profile`, `video.publish`, and `video.upload` scopes                                                                                                                                                                                            |
| X         | OAuth 2.0 enabled with exact callback URL; use a confidential client secret when available                                                                                                                                                                                                                                    |

### Backend / Convex — summary

Set on the **deployment** (Dashboard or `npx convex env set` from `apps/backend`):

| Group                  | Variables                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| **Auth**               | `NEXT_PUBLIC_HEXCLAVE_PROJECT_ID` (same as web)                                                      |
| **Token crypto**       | `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`)                                                      |
| **OAuth server auth**  | `OAUTH_SERVER_SECRET` (same 64-char hex value as `apps/web`)                                         |
| **Social app secrets** | `X_*`, `LINKEDIN_*`, `GOOGLE_*`, `TIKTOK_*`, `META_*`, `THREADS_*` (same values as `apps/web`)       |
| **Stripe billing**     | `STRIPE_SECRET_KEY`, `STRIPE_*_PRICE_ID` (same values as web), `BILLING_SERVER_SECRET` (same as web) |
| **Stripe webhook**     | `STRIPE_WEBHOOK_SECRET` → `https://<deployment>.convex.site/stripe/webhook`                          |
| **R2 media**           | `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_TOKEN`                   |

```bash
cd apps/backend
npx convex env set NEXT_PUBLIC_HEXCLAVE_PROJECT_ID "..."
npx convex env set TOKEN_ENCRYPTION_KEY "$(openssl rand -hex 32)"
npx convex env set OAUTH_SERVER_SECRET "<same value as apps/web>"
npx convex env set STRIPE_SECRET_KEY "sk_test_..."
npx convex env set STRIPE_WEBHOOK_SECRET "whsec_..."
npx convex env set BILLING_SERVER_SECRET "<same random secret as apps/web; at least 32 characters>"
# Set all six STRIPE_*_PRICE_ID values from the price table below.
# npx convex env set R2_BUCKET ...
```

Browser uploads also require a CORS policy on the R2 bucket. The policy in
`apps/backend/r2-cors.json` allows local development and the production app to
upload media with presigned URLs. Apply it while authenticated to the
Cloudflare account that owns the bucket:

```bash
cd apps/backend
npx wrangler r2 bucket cors set <R2_BUCKET> --file r2-cors.json
npx wrangler r2 bucket cors list <R2_BUCKET>
```

### Stripe billing setup

Billing uses Stripe-hosted Checkout through `POST /api/billing/checkout` and the customer portal through `POST /api/billing/portal`. The Convex `@convex-dev/stripe` component verifies webhook signatures and stores Stripe records; the app mirrors subscription state for plan access and workspace limits. The integration uses component `0.1.6` and [Stripe Node SDK `22.6.2`](https://github.com/stripe/stripe-node/releases/tag/v22.6.2), with [API version `2026-08-26.dahlia`](https://github.com/stripe/stripe-node/blob/v22.6.2/src/apiVersion.ts).

1. In one Stripe sandbox, create Creator, Growth, and Agency products, each with the two active recurring USD prices below. Use flat-rate prices with quantity one. Annual prices charge the full annual amount; the app displays their monthly equivalent. See [Stripe's product and price setup](https://docs.stripe.com/products-prices/manage-prices).

| Environment variable              | Recurring interval | Amount charged     | Stripe `unit_amount` |
| --------------------------------- | ------------------ | ------------------ | -------------------- |
| `STRIPE_CREATOR_MONTHLY_PRICE_ID` | Every month        | $29                | `2900`               |
| `STRIPE_CREATOR_YEARLY_PRICE_ID`  | Every year         | $276 ($23/month)   | `27600`              |
| `STRIPE_GROWTH_MONTHLY_PRICE_ID`  | Every month        | $59                | `5900`               |
| `STRIPE_GROWTH_YEARLY_PRICE_ID`   | Every year         | $564 ($47/month)   | `56400`              |
| `STRIPE_AGENCY_MONTHLY_PRICE_ID`  | Every month        | $119               | `11900`              |
| `STRIPE_AGENCY_YEARLY_PRICE_ID`   | Every year         | $1,140 ($95/month) | `114000`             |

2. Put the six `price_...` IDs and the same `STRIPE_SECRET_KEY` in the web environment and Convex deployment. Set `BILLING_SERVER_SECRET` to the same randomly generated secret of at least 32 characters in both runtimes (for example, generate it with `openssl rand -hex 32`). Keep these variables server-only. The web routes use the shared billing secret to authenticate billing operations with Convex.
3. Deploy the Convex functions and configure a Stripe webhook destination at `https://<deployment>.convex.site/stripe/webhook`, using API version `2026-08-26.dahlia`. Set its signing secret as `STRIPE_WEBHOOK_SECRET` on Convex. The destination must receive these app events:

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   - `invoice.paid`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

   These [Stripe event types](https://docs.stripe.com/api/events/types) cover successful, delayed, failed, and expired checkout, subscription changes, and renewal payments. To keep the component's customer, invoice, and payment mirrors complete, also enable `customer.created`, `customer.updated`, `customer.deleted`, `invoice.created`, `invoice.finalized`, `invoice.updated`, `invoice.paid`, `payment_intent.succeeded`, and `payment_intent.payment_failed`, as listed in the [Convex Stripe component documentation](https://github.com/get-convex/stripe#webhook-events).

4. Configure the default [Stripe customer portal](https://docs.stripe.com/customer-management/configure-portal) in the same sandbox. Enable payment method updates, invoice history, cancellation at the end of the billing period, and plan switching. Restrict subscription updates to the three MultiFeed products and exactly these six prices; disable quantity changes. Choose the intended proration policy for upgrades and interval changes. Use the production app URL as the return link and complete the business information and branding.
5. Verify a sandbox checkout, webhook delivery, billing portal plan change, renewal failure, and cancellation before going live. Repeat the product/price, portal, and webhook setup in live mode, then replace both runtimes' keys and price IDs together. Sandbox and live objects and signing secrets are separate. See [Stripe's webhook setup and local forwarding guide](https://docs.stripe.com/webhooks).

### Existing Dodo subscriptions

The integration replaces new Dodo checkout and portal flows with Stripe. Existing Dodo rows and schema fields remain for historical compatibility; the Dodo webhook endpoint is removed. Legacy plan access is limited to the recorded paid `currentPeriodEnd`, so verify that those dates are accurate before deployment.

Existing customers, payment methods, subscriptions, invoices, and refunds are not automatically moved to Stripe. Plan an explicit cutover for each existing subscriber: reconcile their paid period and Dodo renewal status, stop future Dodo renewals in Dodo, and arrange Stripe checkout when that paid period ends. Confirm the old renewal is stopped before starting Stripe billing to avoid charging through both providers. Keep historical Dodo records for reconciliation and handle any outstanding Dodo billing actions in Dodo. Remove obsolete `DODO_*` environment variables after the controlled cutover.

### OAuth flow (reference)

1. `POST /api/oauth/start` → `sessions.create` → provider URL
2. Provider → `GET /api/oauth/callback` → `beginExchange` → token exchange and account discovery
3. All discovered accounts are resolved first, then committed atomically by `accounts.saveMany`

UI: `/connections`

## Notes

- Do not edit `apps/backend/convex/_generated`.
- OAuth uses Next.js API routes; Stripe webhooks use Convex HTTP at `/stripe/webhook`.
- Media uploads use presigned R2 URLs and require the bucket CORS policy above.
- “Post now” queues delivery immediately via `publishing.publishPost`. Scheduled posts register a durable job at their scheduled time; the 1-minute `publishDuePosts` cron recovers missed jobs and stalled deliveries. Targets stay queued until a worker claims them.
