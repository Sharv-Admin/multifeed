# Billing Status Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent generic provider updates from incorrectly granting paid access to paused or unknown-status subscriptions.

**Architecture:** Keep signed-webhook verification, event deduplication, timestamp ordering and existing schema unchanged. Correct only status resolution in the existing billing module. Exercise the registered handler offline with synthetic subscriptions before deployment.

**Tech Stack:** Convex, TypeScript, Node test runner, existing esbuild dependency.

**Spec:** `docs/superpowers/specs/2026-09-30-production-readiness-first-repairs.md`

**Execution status (30 September):** Approved by Shivam. Local implementation and regression checks completed; production deployment/live lifecycle acceptance remain pending. See [repair receipt](../receipts/2026-09-30-production-readiness-repairs.md). The combined release step below remains unchecked deliberately.

## Global Constraints

- Never place secrets in source, reports or chat.
- Preserve customer data and existing signed-webhook verification.
- Do not submit signed production billing events, charge customers or migrate payment providers during this repair.
- Generic subscription sync events must not manufacture entitled `updated` status when provider status is missing or unrecognised.

## Review Focus

- `paused` payload after an explicit paused event remains non-entitled.
- `past_due` does not activate a previously on-hold subscription.
- Missing or unknown status preserves the existing state, whether active or inactive.
- Legitimate active/renewed events retain their existing entitlement behaviour.
- Duplicate and older events cannot reverse the newer stored subscription state.

### Task 1: Repair generic status resolution with regression coverage

**Files:**

- Create: `apps/backend/billing-status.test.ts`
- Modify: `apps/backend/convex/billing.ts`

**Interfaces:**

- Consumes: existing `handleWebhook` registered handler and `grantsPlanAccess(sub, now)`; tests bundle the module in memory with existing esbuild and use a synthetic database.
- Produces: unchanged webhook/query interfaces. `webhookStatus(eventType: string, event: Record<string, unknown>): BillingStatus | undefined` maps generic payload `paused`/`past_due` to `on_hold`; absent/unrecognised status returns undefined, so no subscription upsert occurs.

- [ ] Write failing handler tests: starting from `on_hold`, generic updates with `paused`, `past_due`, missing status and `unknown_future_status` must not grant access. Test missing status on an active subscription preserves active state; test `active`, explicit `subscription.paused`, and explicit renewal.
- [ ] Run `node --experimental-strip-types --test billing-status.test.ts` from `apps/backend`; record baseline failures showing stored `updated` and access granted for paused/unknown inputs.
- [ ] Correct only the private status resolver. Preserve explicit lifecycle-event mappings; add paused/past-due normalization for generic sync events and remove the fallback that invents `updated`.
- [ ] Add duplicate-webhook and older-timestamp assertions: neither can change a newer stored `on_hold` subscription to active. Preserve cancelled-at-period-end access behaviour.
- [ ] Run `node --experimental-strip-types --test *.test.ts`, backend type checks, lint and formatting. All changed-file diagnostics must pass; do not conflate existing web OTP lint failures with this repair.
- [ ] Commit `fix: preserve subscription status on generic updates`. Deploy the reviewed exact SHA, recheck production identity first, and retain rollback. Verify unsigned webhook remains HTTP 401 and record live billing lifecycle testing as still unverified.

## Execution gate

Review before implementation. Native execution is recommended for this single narrow task; no payment configuration or live subscription mutation is part of its acceptance test.
