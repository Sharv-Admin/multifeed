# MultiFeed first production-readiness repairs

## Objective and authority

Shivam requested end-to-end testing, investigation and safe repairs. Start with token renewal and team access, not new marketing features. Do not purchase services, publish real social posts, permanently delete data, change credential ownership, or grant another person access without the required specific approval. Never place secrets in source, reports or chat.

## Verified baseline — 30 September 2026

- Source: `Sharv-Admin/multifeed`, commit `7b768e85a78e0bb7b79edecd9b196790117d37ee`.
- Last verified live Vercel deployment: `dpl_FtwYrDrFj7WTSNQY8CuH1a3Z64ie`; recheck before any release.
- Backend: `multifeed:multifeed:prod`, `reminiscent-marmot-734.eu-west-1.convex.cloud`.
- Owner has six stored social connections. Stored/active is not provider health proof.
- Convex names-only environment inspection lacks `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`. Vercel lists corresponding sensitive variables; their values were not recovered. Threads renewal uses the stored token rather than app credentials.
- Owner YouTube token expired before this audit. Local isolated execution reproduces missing-configuration errors for YouTube, X and Instagram before any network request.
- Draft creation, update, reload and reopening through All Posts worked in production. One clearly labelled QA draft remains, with zero targets and no publishing job. Its stored draft date is not an active schedule.
- Existing backend helper suite: 11 tests passed. Backend and web type checks passed. Full lint fails on 14 existing sign-in OTP styling diagnostics.
- Mock claim checks and read-only production queries cover selected authentication and team-isolation boundaries; these are not a complete security audit or independent JWT-verification test.
- The profile menu and sidebar have no normal workspace chooser. The invitation acceptance screen has a membership-bound fallback chooser, but it is not a general navigation feature.
- Historical database records contain two published targets and two failed X targets. Provider-side verification has not been performed; records are not proof of current publishing success or genuine paid customers.
- Inbox route is a heading/description only. No inbox ingestion or post-metric collection implementation was found. Do not claim these are launch-ready.

## Second audit pass — additional evidence

- Ten offline publishing state-machine scenarios passed: initial claim, duplicate delivery, published-target deduplication, unknown-outcome stale failure, checkpoint resume, obsolete draft jobs, future scheduling, fan-out skipping terminal targets, failed-only retry, cross-team retry rejection, and retry-budget termination. These use synthetic database/scheduler objects, not real concurrent Convex transactions or provider delivery.
- Recent production log sample contained 58 successful `publishing:publishDuePosts` executions. There were no currently due scheduled posts or stale publishing posts. This proves the cron is executing, not that a real scheduled social post succeeds.
- Ten offline media boundary scenarios passed. Server metadata overrides client URL/size, ownership and uploader identity are checked, oversize objects fail, attached media cannot be deleted, and client returns omit internal storage identifiers. Live upload/CORS remains unverified.
- Five offline webhook-authentication assertions passed; a live unsigned synthetic request to `/webhook/dodopayment` returned HTTP 401. No signed production event was submitted.
- Six live unauthenticated API rejection checks passed: team invitations, OAuth start and checkout each reject a foreign Origin with HTTP 403 and same-origin requests without authentication with HTTP 401. Responses use `private, no-store`. No invitation, OAuth session or checkout was created.
- Confirmed billing defect: `subscription.updated` with `status: "paused"` stores `updated` and grants access to a previously on-hold subscription. Missing status and `past_due` follow the same permissive fallback. Explicit `subscription.paused` correctly maps to `on_hold`. The provider's current [official status definitions](https://github.com/dodopayments/dodopayments-typescript/blob/main/src/resources/subscriptions.ts) include `paused` and `past_due`.
- Confirmed publishing defect: a due post whose destinations are all `skipped` becomes `published` while scheduling zero provider jobs. This was reproduced with synthetic objects only.
- A historical published Threads target references a deleted connection. Disconnect cleanup intentionally retains published history while deleting the connection; this is not evidence of cross-team access. No actual team mismatch was found in the target relationships checked.
- Public DNS has no root MX record (`NOERROR`, zero answers). A Resend DKIM record, DMARC quarantine policy, and outbound SPF records are present. These do not prove inbox placement, full sender alignment, or inbound support-mail delivery. The DMARC report address currently belongs to `onsecureserver.net`; report ownership has not been verified.
- Source/production distinction: the two status defects above are reproduced in repository source `7b768e85a78e0bb7b79edecd9b196790117d37ee`, not by changing live subscriptions or scheduling live posts. The exact uploaded Convex source version has not independently been retrieved. Do not claim that a real customer has already encountered either defect. Vercel's domain still resolves to the previously verified Ready deployment, and remote main still matches the audited SHA.

## Third audit pass — OAuth boundaries

- Twenty-four offline assertions passed using random dummy encryption keys and synthetic sessions: credential round trip, different IVs for repeated encryption, ciphertext tamper rejection, wrong-key rejection, malformed credential rejection, eight unsafe redirect vectors, an allowed query-preserving redirect, random state and PKCE shape, wrong-team and wrong-user rejection, incorrect server-secret rejection, unknown-state rejection, first-exchange verifier consumption, sequential callback replay handling, completion-marker handling, expired-session cleanup, and refusal to complete an unstarted exchange.
- These are sequential mock-database checks of the audited source. They do not prove concurrent Convex transaction behaviour, live OAuth consent, provider app verification, or real customer token validity. Production encryption keys and social tokens were not accessed or changed.
- The callback rechecks the signed-in user's connection-management permission before exchange and does not put the provider authorization code into its sign-in redirect. This is source inspection, not proof of the deployed callback under every permission configuration.
- No additional defect was reproduced in these scoped checks. This is not a complete security certification.

## Execution approval and current boundary

Shivam approved these four plans and native implementation in this session on 30 September 2026. Their local code/test work has been implemented; see the [repair receipt](../receipts/2026-09-30-production-readiness-repairs.md) for exact commits, verification and remaining gates.

- [Social token renewal](../plans/2026-09-30-social-token-renewal.md): secure credential recovery and configuration; do not rotate the existing encryption key or OAuth app identities.
- [Workspace navigation](../plans/2026-09-30-team-workspace-navigation.md): membership-bound workspace selection, preserving explicit invitation acceptance and owner-access restrictions.
- [Billing status truth](../plans/2026-09-30-billing-status-truth.md): fail closed on unknown/missing provider status without manufacturing paid access.
- [Publishing status truth](../plans/2026-09-30-publishing-status-truth.md): distinguish all-skipped from actual publication and avoid no-op Retry.

Shared-branch integration and release are separate gates. Live token renewal also requires a secure source for the existing OAuth credentials; provider-side publishing verification requires explicit approved accounts/content. The audit has not deployed these repairs, accepted a real invitation, changed customer subscriptions, or published a social post.

## Additional status-truth repair requirements

- Generic subscription sync events must not manufacture entitled `updated` status when provider status is missing or unrecognised. Preserve the existing record rather than granting new access. Map `paused` and `past_due` to the existing non-entitled `on_hold` state; any intentional grace-period policy is a separate product decision.
- A terminal post is `published` only if at least one destination is actually `published`. All skipped or all failed destinations result in `failed`. Mixed published/skipped outcomes retain individual destination statuses and overall published history.
- Offer Retry only when at least one target has status `failed`; all-skipped outcomes must not expose a retry that cannot do anything. Preserve Duplicate as the available recovery path after reconnecting/selecting destinations.

## Repair requirements

### Token renewal

1. Use the same existing OAuth apps as the Vercel connection flow. Recover their credentials through an authorised secure source; do not invent replacements or rotate app IDs.
2. Configure only verified required credentials in the explicit production Convex deployment. Preserve `TOKEN_ENCRYPTION_KEY`, R2, billing, Hexclave and owner-access settings.
3. Verify existing refresh logic using mocked provider responses before any live renewal. Never log tokens or send them to an unintended endpoint.
4. Keep provider rejection distinct from temporary network/configuration failure. Do not mark an account revoked or reconnect it just because local configuration is missing.
5. A live renewal must persist the new encrypted token before it is called successful. Live publishing and scheduling require a separate approved target/content; no automatic retries of historical failures.

### Team/workspace navigation

1. Existing accounts join the invited team without losing their personal workspace or creating a duplicate identity.
2. List only the signed-in user's verified memberships. Verify `getTeam(teamId)` before selecting; never trust a team ID from a URL or team display name.
3. Provide a normal workspace chooser in the existing profile menu. Selecting a workspace must fully reload `/overview`, discarding old workspace client caches.
4. Do not widen owner complimentary access: its exact server-configured user, verified email and team restrictions stay unchanged.
5. Preserve explicit invitation acceptance, email mismatch/expired-link handling, and membership fallback behaviour. Duplicate clicks must not cause parallel selections.

## Launch gates beyond these repairs

Still verify real invitation acceptance for new and existing accounts, Google/email sign-in including failure paths, upload ownership, real provider readback after immediate/scheduled publishing, retry/idempotency, customer limits, email delivery/authentication, deployment rollback, and payment ownership/webhooks. Unsupported advertised features require a separate product decision, not a speculative implementation in this repair.
