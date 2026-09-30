# Publishing Status Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Never display a post as published when every destination was skipped, and avoid offering an ineffective retry.

**Architecture:** Correct terminal reconciliation without changing scheduler claims, checkpoints or provider calls. Align the existing post action menu with the retry mutation's failed-target requirement. Keep historical data untouched.

**Tech Stack:** Convex, Next.js 16, React, TypeScript, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-30-production-readiness-first-repairs.md`

**Execution status (30 September):** Approved by Shivam. Local implementation and regression checks completed; deployment and live provider delivery remain pending. See [repair receipt](../receipts/2026-09-30-production-readiness-repairs.md). The combined release step below remains unchecked deliberately.

## Global Constraints

- Do not publish real social posts or retry historical failed posts during this repair.
- Preserve customer data and individual destination statuses.
- A terminal post is `published` only if at least one destination is actually `published`.
- Offer Retry only when at least one target has status `failed`.

## Review Focus

- All-skipped disconnection outcomes are not represented as successful publication.
- Published plus skipped/failed destinations retain genuine published history without retrying successful destinations.
- Pending/publishing destinations keep the overall post in progress.
- Terminal posts with zero targets remain failed, not successful.
- Failed-only retries preserve provider checkpoints and do not retry skipped destinations.

### Task 1: Correct reconciliation and the retry action

**Files:**

- Create: `apps/backend/publishing-state.test.ts`
- Modify: `apps/backend/convex/publishing.ts`
- Modify: `apps/web/src/components/posts/PostsTable.tsx`

**Interfaces:**

- Consumes: existing registered `publishPost`/`reconcilePostStatus` handlers, post/target statuses and `posts.retryFailed` contract.
- Produces: unchanged backend interfaces. Private `reconcileStatus(ctx, postId)` keeps `publishing` while destinations are pending, otherwise returns `published` only with a published destination, and `failed` otherwise. `PostsTable` computes retry availability from failed targets, not merely parent status.

- [ ] Add a failing in-memory handler test: a due scheduled post with only `skipped` destinations must finish `failed`, schedule zero provider jobs, and leave target statuses/checkpoints intact. Also test no targets and all failed.
- [ ] Run `node --experimental-strip-types --test publishing-state.test.ts` from `apps/backend`; baseline all-skipped outcome must fail because it becomes `published`.
- [ ] Update only terminal reconciliation and remove any now-unused variable. Preserve published-plus-failed/skipped status as published and pending states as publishing.
- [ ] Add regression tests for duplicate claim, known checkpoint resume, unknown-outcome stale failure, and failed-only retry. These must retain their previously observed safe behaviour.
- [ ] Update `PostsTable` retry visibility to require `post.targets.some(target => target.status === "failed")`; leave Duplicate available for all-skipped outcomes. Verify all-skipped and mixed-result menus with a local mocked view, not production data changes.
- [ ] Run backend tests, backend/web type checks, changed-file lint and formatter; verify desktop/mobile menu behaviour and no new console errors.
- [ ] Commit `fix: report all-skipped posts as failed`. Release the exact reviewed SHA only after checking current production identity and rollback. Keep real provider and scheduled-delivery readback as a separate authorised test.

## Execution gate

Review before implementation. Native execution is recommended because the two changes share the same retry/status invariant and introduce no new routes or permissions.
