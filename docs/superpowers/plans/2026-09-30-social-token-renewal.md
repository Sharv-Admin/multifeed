# Social Token Renewal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the existing production social-token renewal configuration and verify it without publishing customer content.

**Architecture:** Retain the existing provider refresh implementations and encrypted account storage. First pin behaviour with mocked tests, then provision the same OAuth-app credentials used by Vercel through a secure authorised source. Separate configuration validation from live renewal and provider-side publishing evidence.

**Tech Stack:** Convex, TypeScript, Node test runner, existing esbuild dependency, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-30-production-readiness-first-repairs.md`

**Execution status (30 September):** Approved by Shivam. Task 1's 15 offline baseline tests pass; no provider logic change was required. Task 2 remains blocked on secure recovery of the original OAuth credentials. No production variables were changed. See [repair receipt](../receipts/2026-09-30-production-readiness-repairs.md).

## Global Constraints

- Target only `multifeed:multifeed:prod` for approved production configuration writes.
- Preserve `TOKEN_ENCRYPTION_KEY`, R2, billing, Hexclave and owner-access settings.
- Never place secrets in source, reports or chat.
- Do not purchase services, publish real social posts, permanently delete data, change credential ownership, or grant another person access without the required specific approval.
- Do not rotate existing OAuth app IDs or retry historical failed posts.

## Review Focus

- Missing required configuration fails before sending any refresh token to a provider; test this for YouTube, X and Meta.
- Temporary provider failures retain the connection rather than classifying a grant as revoked; test network failure and HTTP 500 separately.
- Definitive `invalid_grant` responses use `TokenRefreshRejectedError`; test this separately from HTTP 429.
- Provider rotation preserves the returned refresh token, while an omitted replacement retains the existing one; test both X responses.
- A stored active connection with an expired token is not reported as a successful live renewal without fresh encrypted-token persistence and expiry readback.

### Task 1: Pin current refresh behaviour before configuration changes

**Files:**

- Create: `apps/backend/token-refresh.test.ts`
- Existing implementation under test: `apps/backend/convex/publishing/tokenRefresh.ts`
- Modify implementation only if these cases reproduce a confirmed defect.

**Interfaces:**

- Consumes: `refreshAccessTokenForPlatform(account: Doc<"connectedAccounts">, refreshToken: string): Promise<RefreshedToken | null>` and `isTokenRefreshRejected(error: unknown)`.
- Produces: automated offline tests using bundled module imports, mocked `fetch`, dummy credentials and restored process environment. No public endpoint, new runtime dependency or network access.

- [ ] Write tests for the five review-focus behaviours above. Assert zero `fetch` calls when required credentials are missing; assert grant rejection is distinct from timeout/500/429; assert X refresh-token rotation and preservation.
- [ ] Run `node --experimental-strip-types --test token-refresh.test.ts` from `apps/backend`; record expected baseline passes or a specific failing assertion before changing provider logic.
- [ ] Fix only a demonstrated incorrect classification or preservation behaviour in the existing refresh implementation; do not redesign publishing or add a scheduled refresh service.
- [ ] Run `node --experimental-strip-types --test *.test.ts` and `./node_modules/.bin/tsc --noEmit` from `apps/backend`; all must pass.
- [ ] Commit only the tested refresh changes and regression test: `test: cover social token renewal failures` (use `fix:` only if a functional defect was fixed).

### Task 2: Restore exact production configuration and prove renewal

**Files:**

- No secret-bearing files may be created or committed.
- Update only the verified credential variables in Convex; record a redacted verification receipt in this plan.

**Interfaces:**

- Consumes: existing provider-console/handover credentials matched to Vercel's OAuth apps, and the Task 1 passing offline tests.
- Produces: production configuration receipt containing variable names, deployment identity and verification outcome only.

- [ ] Recover the existing Google, X and Meta credentials from an authorised secure source. Add LinkedIn/TikTok only when their existing apps are verified and in scope. Stop if the source or app identity cannot be established.
- [ ] Confirm the selected production deployment and capture the existing variable-name list. Require specific confirmation before a browser-based secret transmission if not already authorised.
- [ ] Set the verified credentials through a secret-safe mechanism that does not expose values in tool output, shell history or source. Do not overwrite unrelated values.
- [ ] Re-read variable names; compare with the required provider keys. Names present is configuration proof, not provider proof.
- [ ] Verify one owner account's renewal using the existing refresh path, with no social publish unless target/content are specifically approved. If no safe live invocation exists, report renewal as unverified and agree the smallest test harness before adding an endpoint.
- [ ] Read back only status, expiry and encrypted-token-presence metadata. A fresh persisted expiry/token is required before recording success; never print encrypted or decrypted token values.
- [ ] Record the result and remaining provider approval/account-billing blockers in the plan; do not claim launch readiness from configuration alone.

## Execution gate

Review this plan before implementation. Recommended approach: native execution in the current session; the work is small and the critical prerequisite is verified credentials, not concurrent code changes.
