# MultiFeed approved repair receipt — 30 September 2026

## Scope and identity

Human approval: “Approve the plans; implement here.” Four approved plans are linked from the production-readiness spec. Local implementation does not certify the SaaS for launch.

Repository: `Sharv-Admin/multifeed`. Branch: `codex/team-invitation-existing-users`. Isolated checkout: `/private/tmp/multifeed-invitation-yYLqZL`. Audited base: `7b768e85a78e0bb7b79edecd9b196790117d37ee`.

Code commits before final review:

- `82fdf8a152f65e0c29944bdc6b4373d92f72b53c`: generic billing updates no longer invent entitled status; paused/past-due become on hold.
- `d32785e90a689659e3e2f131278740340fbe3ab0`: all-skipped posts become failed; Retry requires an actually failed destination.
- `fe98ba87d26518c3a47897d04812ef39b9847bcc`: verified workspace selection helper and invitation regression tests.
- `4afe2f96966ceda5ff307768d333c8fbfd60c659`: profile-menu chooser with membership lookup, errors, synchronous click guard and full navigation.
- `b9a6b014fda8975142aee37a7b1be00ca27d64b7`: token renewal failure/rotation/encrypted-persistence tests. Existing renewal implementation passed all 15 cases; no provider logic changed.
- `4f07ae97a88d1737966aab3fbc778c6aab336fe4`: review-discovered profile popup guard fix. This is the final source-code SHA; a later documentation-only commit preserves this receipt and the approved plans.

No production environment variables, social tokens, encryption keys, subscriptions, memberships or customer posts were changed. No purchase, real invitation acceptance or provider publication was performed. The previous production identities in the spec are historical audit evidence, not a new release receipt.

## Verification

| Check                         | Result and boundary                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend suite                 | 48/48 pass using `node --experimental-strip-types --test *.test.ts` in `apps/backend`                                                                      |
| Web helper suite              | 7/7 pass using the Node runner in `apps/web`                                                                                                               |
| Backend and web TypeScript    | Both no-emit checks pass; Next route type generation passes                                                                                                |
| Formatting                    | Whole-repository `oxfmt --check` passes after formatting the four plans                                                                                    |
| Changed-file lint             | Passes; no new diagnostics in repair files                                                                                                                 |
| Full lint                     | Fails with 14 pre-existing OTP styling diagnostics at sign-in page line 184; not repaired by this scope                                                    |
| Actual local production build | Compilation and TypeScript pass, then page collection fails on missing `NEXT_PUBLIC_CONVEX_URL`                                                            |
| Public-variable fixture build | Compilation and TypeScript pass, then page collection fails on missing `HEXCLAVE_SECRET_SERVER_KEY`; fixture values are not production configuration proof |
| Diff whitespace               | `git diff --check` passes                                                                                                                                  |
| Release                       | Not pushed, merged or deployed; exact deployment acceptance remains pending                                                                                |

Billing RED: five of ten assertions failed on the old manufactured `updated` state; GREEN after the private resolver repair. Publishing RED: all-skipped was reported `published`; GREEN after terminal-state repair. Workspace helper RED: module absent; GREEN after implementation. Renewal tests intentionally pin passing baseline behaviour rather than inventing a defect.

Backend fixtures bundle actual registered handlers with existing esbuild, using synthetic sequential database/scheduler objects and random dummy encryption keys. They do not prove Convex concurrent transactions, rollback, live JWT verification or real provider delivery.

## Browser QA

Environment: Chrome, offline fixture `http://127.0.0.1:3218/`, actual profile-menu and post-table components, mocked authenticated SDK and post actions. The fixture uses shared UI styles; missing Next font variables mean this is functional/layout proof, not exact production typography proof. No live account or membership mutations occur.

- Correct route/title, meaningful content, no framework overlay and no current fixture console errors.
- Personal/current workspace disabled; invited membership selectable. Single- and multiple-workspace lists render.
- Lookup failure offers Reload workspaces; revoked membership and selection failure show recoverable errors without navigation.
- Double click selects once and fully navigates to `/overview` in the successful fixture. Its rendered receipt reads `Workspace reloaded: beta — selections: 1`.
- All-skipped failed post menu hides Retry and preserves Duplicate. Mixed failed destinations expose Retry. Click receipts verify the bound actions without backend mutation.
- At 360×800, document width is 360 and menu bounds stay inside the viewport (left 24, right 248, bottom 456).
- Desktop and mobile screenshots: `/tmp/multifeed-repair-workspaces-desktop.png`, `/tmp/multifeed-repair-workspaces-mobile.png`.

Real invitation acceptance, post-navigation production data isolation, deployed invitation/sign-in redirects and current provider delivery remain unverified. Previous foreign-team query rejection is separate evidence, not this browser test's proof.

## Independent review and one fix pass

One fresh-context reviewer reviewed the entire `7b768e8..b9a6b01` range and independently reran 48 backend and seven web tests. No Critical or Minor finding. One Important finding: popup dismissal unmounted the workspace guard, permitting a second pending selection after reopen.

Manual deferred-request UI regression `profile-close-reopen` was written and run against the actual components. RED: select invited workspace, press Escape, reopen and select another workspace; rendered `Selection calls: 2`. Fix: move the hook's state/ref into the persistent profile parent, leaving the popup a view. GREEN: reopened menu retains Opening workspace and disables both destinations; rendered `Selection calls: 1`. This is a manual browser regression, not an additional automated Node test. After failure, the error survives dismissal and reopening; retry is enabled and starts the next request only after the prior failure. After the fix, backend 48/48 and web 7/7 pass, both type checks pass, changed-file lint and whole-repository formatting pass. The independent review's only Important finding is addressed in this one fix pass; no re-review was dispatched.

The temporary fixture initially rebuilt without the repository CSS scan base, producing an unstyled screenshot. This was a fixture issue, not a production-code issue. The scan base was corrected to the repository; final desktop/mobile screenshots were visually inspected with styles loaded and the 360×800 menu bounds rechecked. Next font variables remain absent, as disclosed above.

## Rulings made during execution

Repeated ledger decisions are deduplicated here; every distinct decision and its cost is preserved.

1. Keep the existing isolated disposable clone/feature branch instead of making another checkout: user requested implementation here and the iCloud original is left untouched. Cost if wrong: work remains local in this clone until integration/release.
2. Run the underlying Node test suite directly after global pnpm attempted an unnecessary install and aborted. Cost if wrong: package-manager script wiring is not separately verified, though the same backend tests run.
3. Reuse test-only bundle/database fixtures to execute registered handlers. Cost if wrong: sequential mocks may miss live transaction behaviour.
4. Defer shared writes and production deployment until reviewed code and explicit integration/release choice. Cost if wrong: production defects remain until release. Real provider publishing is separately authorized.
5. Enable `allowImportingTsExtensions` for the no-emit web check, matching backend's real-module Node test convention. Cost if wrong: extra import spellings become compile-valid; runtime imports are unchanged.
6. Use installed SDK `user.selectedTeam`, not the plan's nonexistent `useSelectedTeam` hook. Cost if wrong: current-workspace label may lag until SDK refresh; full navigation remains.
7. Reviewer set aside actual provider renewal/publishing: retain these as unverified until original credentials and approved live test targets exist. Cost if wrong: provider failures may still prevent customer posting.
8. Reviewer set aside real invitation acceptance/cache isolation: retain these as unverified, not passed by mocks. Cost if wrong: the actual invited-user path or data transition may still fail.
9. Reviewer set aside deployment readiness: retain missing build configuration and deployment acceptance as release gates. Cost if wrong: integration/deployment may expose configuration failures.

Deferred minors: none from this review. The existing OTP lint diagnostics remain a separate known issue, not a new reviewer minor.

## Remaining operator gates

1. Choose branch integration; run preview with real securely supplied environment, verify exact deployed SHA and rollback before production promotion.
2. Recover original Google, X and Meta OAuth credentials securely and match their existing app IDs. Never paste credentials into chat or rotate `TOKEN_ENCRYPTION_KEY`. Configuration names alone are not renewal success.
3. Prove owner-token renewal with encrypted persistence and fresh expiry readback, then separately approve a named test target/content for real immediate and scheduled delivery.
4. Complete real new/existing-user invitation acceptance, sign-in/error paths, upload checks and customer limits.
5. Finish inbound support-mail setup; root MX was absent at audit. Resolve advertised Inbox/metrics scope and payment ownership/webhooks before paid launch.
