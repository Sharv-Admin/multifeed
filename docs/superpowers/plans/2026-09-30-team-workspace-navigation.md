# Team Workspace Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let existing customers move safely between their personal and invited workspaces without widening permissions or carrying old-team data into the new view.

**Architecture:** Add a membership-bound chooser inside the existing profile menu. Reuse a small verified-selection helper from both that chooser and the invitation fallback, then perform a full navigation to clear client caches. Keep acceptance explicit and preserve the existing provider's verified-email checks.

**Tech Stack:** Next.js 16, React, Hexclave SDK, existing shared UI components, TypeScript and Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-30-production-readiness-first-repairs.md`

**Execution status (30 September):** Approved by Shivam. Local helper/chooser implementation and offline browser checks completed, including the review-discovered popup-unmount fix. Real invitation acceptance, production data transition and deployed acceptance remain pending. See [repair receipt](../receipts/2026-09-30-production-readiness-repairs.md).

## Global Constraints

- List only the signed-in user's verified memberships.
- Verify `getTeam(teamId)` before selecting; never trust a team ID from a URL or team display name.
- Selecting a workspace must fully reload `/overview`, discarding old workspace client caches.
- Exact owner complimentary-access user, verified email and team restrictions stay unchanged.
- Do not accept real invitations, grant access or delete customer data as part of an automated test.

## Review Focus

- A requested team ID not present in verified membership must never reach `setSelectedTeam`.
- Provider lookup or selection failure must leave the previous workspace selected and show a recoverable error.
- Concurrent clicks must not launch parallel workspace changes.
- Multiple invitations disappearing together must retain the existing membership chooser instead of guessing a destination.
- Email mismatch or acceptance failure must not trigger workspace selection, reload, or duplicate invitation acceptance.

### Task 1: Verified selection helper and regression tests

**Files:**

- Create: `apps/web/src/lib/select-verified-workspace.ts`
- Create: `apps/web/team-workspace.test.ts`
- Modify: `apps/web/src/components/team/TeamInvitationContent.tsx`
- Test existing: `apps/web/src/lib/accept-team-invitation.ts`

**Interfaces:**

- Consumes: user methods `getTeam(id: string): Promise<{ id: string } | null>` and `setSelectedTeam(id: string): Promise<void>`.
- Produces: `selectVerifiedWorkspace(user: WorkspaceSelectionUser, teamId: string): Promise<void>`; rejects missing membership, provider lookup errors and selection errors. It does not navigate or create membership.
- Component callers retain their synchronous pending guard and fully navigate only after the helper succeeds.

- [ ] Write a failing helper test: a missing `getTeam` result rejects and `setSelectedTeam` is never called; verified membership invokes selection once with the verified ID. Assert lookup and selection errors are propagated.
- [ ] Run `node --experimental-strip-types --test team-workspace.test.ts` from `apps/web`; initial failure must identify the missing helper.
- [ ] Implement the exact helper interface and use it in `TeamInvitationContent.openWorkspace`; preserve its pending guard, error copy and successful `window.location.replace("/overview")`.
- [ ] Add invitation-helper tests for successful exact consumed-team selection, ambiguous consumed invitations, acceptance rejection/email mismatch, and selection failure after already successful acceptance. Assert no guessed workspace and no second accept call.
- [ ] Run the tests and `./node_modules/.bin/next typegen && ./node_modules/.bin/tsc --noEmit` from `apps/web`; all pass before committing `test: cover verified team workspace selection`.

### Task 2: Add the profile-menu workspace chooser and verify release

**Files:**

- Create: `apps/web/src/components/layout/WorkspaceSwitcher.tsx`
- Modify: `apps/web/src/components/layout/UserProfileMenu.tsx`
- Reuse: `apps/web/src/lib/select-verified-workspace.ts`

**Interfaces:**

- Consumes: signed-in Hexclave user, `listTeams()` verified membership list, `useSelectedTeam()` current selection, and the Task 1 helper.
- Produces: a `WorkspaceSwitcher` profile-menu child with named workspace controls, current-workspace indication, loading/error states and disabled parallel selections. No new routes, server permissions or backend tables.

- [ ] Add chooser controls using the existing shared dropdown/button components and theme tokens. Load membership through user-scoped SDK methods; do not pass arbitrary server-wide teams to the client.
- [ ] On selection, synchronously guard duplicate clicks, await the verified-selection helper, then fully navigate to `/overview`. On failure keep the previous workspace and display a retryable message.
- [ ] Run helper tests, web type checks and formatter. Record full lint's existing OTP diagnostics separately; introduce no additional lint errors.
- [ ] Browser-test one-workspace, multiple-workspace, selection failure, duplicate-click and mobile layouts. Use mocks/test users for membership mutations; do not silently change Archana's access. Verify old-team data is absent after the full reload using authorised read-only queries.
- [ ] Commit the narrow UI change. Deploy only the reviewed exact SHA to a preview first; recheck current production identity before promoting it and retain the previous deployment for rollback.
- [ ] Verify the deployed profile chooser, invitation route, sign-in return path and console. Record real invitation acceptance as unverified until the invited customer accepts, or specific approval permits that test.

## Execution gate

Review this plan before implementation. Recommended approach: native execution in the current session; both tasks share one small interface and avoid new access privileges.
