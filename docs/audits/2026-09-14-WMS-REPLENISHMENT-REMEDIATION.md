# Warehouse Replenishment Follow-Up - September 14

## Status

The database correction is applied and its no-write ordinary-user probe is verified. The inventory entry and guidance remain application candidates, not released or fully certified. SMTP is excluded. The current UAT app is `9c712baeb4c9ecb4e7bb84049fa8e9f977e81306`. No isolated-role accounts or credentials were created in this review.

## What We Confirmed

Operations has an existing `warehouse.recommend_replenishment` capability, but its only recommendation panel was inside a page requiring `warehouse.view_procurement`. Adding a link to that page would still fail and would expose the wrong viewing boundary.

The live public recommendation RPC checks the correct effective capability, then calls an older implementation that requires one of three unrelated Procurement/viewing capabilities. At `2026-09-13T17:43:40.871Z`, an ordinary Operations Associate session submitted an intentionally invalid zero-quantity recommendation. Instead of reaching quantity validation, UAT returned HTTP 400 / `P0001`: **Procurement authorization is required**. The product reference was the deliberately nonexistent `WMS-REPLEN-GUARD-PROBE-NO-WRITE`. Independent database readback at `17:44:01.624606Z` confirmed zero matching recommendation rows. This is a reproduced authorization failure and no-write negative probe, not a successful replenishment journey.

The older implementation also updates active recommendations by product even after acceptance or handoff. That can replace the approved quantity/rationale while leaving the linked request unchanged. The correction must reject stale edits to decided snapshots atomically, not rely only on a disabled button.

## Fix And Verification Plan

- Keep the public RPC, existing effective capabilities, Procurement decision sequence and audit. Align its inner action checks with the outer checks; do not add broad Procurement grants.
- Permit the existing update/repeat behavior only while the recommendation is still `recommended`. Reject an overwrite once it is `accepted` or `handed_off`. Keep the active-product unique index and require failure to leave the recommendation, linked request and audit unchanged.
- Add a recommendation-only action in the authorized inventory product context. Show the selected product and authorized inventory data, not suppliers, spend, management buttons or links to restricted Procurement records. Quantity/rationale and any lead-time planning assumption must be explicit; do not label an assumed lead time or bounded history as a supplier forecast.
- Read the selected product's active recommendation state, not an arbitrary first 200 records. A failed read, pending permissions, revoked permission or unknown submit outcome must not become a fresh empty form or automatic retry.
- Test the complete ordinary-user recommendation, Procurement acceptance and linked draft handoff; repeat at desktop and mobile widths with persisted actor/quantity/audit checks. Keep malformed/forbidden calls and duplicate/decided-snapshot attempts separate from successful-flow evidence.

At `2026-09-13T17:54:29.24028Z`, live metadata confirmed the partial unique index on active product recommendations and the existing SELECT policy (`warehouse.view_inventory` or `procurement.view_dashboard`). The public RPC allows authenticated/service execution but not anonymous execution; the inner implementation denies authenticated and anonymous direct execution. Its old definition MD5 was `92c9cac13f202e62afcb81cda0928813`; the public wrapper MD5 was `bcb0f480d1e7206457f42ec8bb76e4f7`. The correction does not propose widening these read policies or execution privileges.

## Database Verification

The reviewed migration was applied as `20260913175711_align_replenishment_action_authority_and_snapshot`. Fresh readback at `2026-09-13T17:57:28.381651Z` confirmed the action-specific inner checks and the accepted/handed-off conflict predicate. The public wrapper MD5 stayed `bcb0f480d1e7206457f42ec8bb76e4f7`; the inner MD5 became `797cededb436b00531a3260cd87674cb`. Public and inner execution privileges remained exactly as recorded above. No role or SELECT policy was widened.

Parent and independent reviewer each ran the 12 isolated SQL tests successfully. The fixture loads the actual recommendation table, August 4 implementation and August 13 wrapper/rename/ACL, with limited supporting tables and simulated capability evaluators. It checks absence/revocation of authority, actual anonymous wrapper denial, direct-inner denial, unchanged outer body/ACL, supported transitions and refusal to overwrite decided snapshots. A single-backend PGlite test is not a true two-session concurrency test or full live Procurement integration.

At `2026-09-13T17:58:11.090Z`, the same ordinary Operations Associate zero-quantity probe on application `9c712ba` now returned **Quantity, stockout risk, and rationale are required**, showing that the obsolete authorization rejection no longer intercepts the request. Independent readback at `17:58:37.026671Z` confirmed zero probe rows. This does not establish successful recommendation creation, acceptance or handoff. Before/after security advisors reported the same 13 informational RLS-without-policy findings and no new finding category/count; these existing notices were not removed by weakening private-table policies.

## Audit Improvements

The signoff contract now explicitly requires recommendation, acceptance and handoff on both desktop and mobile. The registry has 48 checkpoints / 94 evidence records, adding six requirements without crediting older role-only results. All 107 contract/evidence-verifier tests passed after two new tests first failed against the old registry. These are synthetic verifier tests, not live business completion. Pilot scenario P16 is prepared and remains blocked until the release and live journey are checked.

The separate inbound KB candidate corrects receiving, inspection, putaway and continuing-hold owners, distinguishes reader access from execution, and explains existing actor separation. It preserves the flow edges, node/evidence IDs and previous screenshot bindings. Parent full-shell tests passed 769 with one skip; an independent reviewer checked 90 targeted cases. These checks do not recertify the old captures or the other unresolved flow-owner findings.

## CI Follow-Up

GitHub run `34736109548` was still queued on superseded build `75e733b`; its two transaction jobs had not started. Its six route jobs had completed earlier. Cancellation was requested after checking its exact identity and state, and it became terminal/cancelled at `2026-09-13T17:44:23Z`. Existing evidence was retained.

The waiting run `34772058143` then started and failed at lint, before new transactions. Its six lint errors were missing explicit Node `URL`, `process` and `console` imports in two warehouse layout-test files. The same errors were reproduced locally, then fixed with imports, not disabled rules. Warehouse lint passed. Tracked-file lint passed in the other completed packages with seven existing warnings; a command-length limit prevented that invocation on Warehouse, which was checked separately. Warehouse, Work and shell lint subsequently passed. An unfiltered whole-worktree lint run remains affected by an unrelated, untracked Finance browser test; that file is outside this release and was left untouched. Fresh CI after the final candidate is still required.

## Remaining Limits

The reviewed Inventory component adds no new Procurement route or grant. It checks only the selected product's active status before opening the form and again before saving. Independent review caught a misleading disabled form in accepted/handed-off states: its numbers came from a proposed draft, not the approved record. The corrected component hides those inputs and Save for these states. All 81 focused UI tests passed independently; the parent full Warehouse suite passed 1,085 tests. The parent combined SQL/signoff-contract/evidence run passed 119 tests, and 49 handbook/release-verifier tests passed. These are local tests, not live transaction or screenshot certification.

The production build compiled, typechecked and generated its pages successfully, but its Turbo wrapper did not exit after reporting completion. That wrapper was stopped by verified process identity. A direct `pnpm --filter @intra/shell build` then completed with exit zero, including typechecking and static generation; the service-worker precache was 17,010.95 KiB. No application or test behavior was changed to hide the wrapper issue. The unrelated untracked Finance lint issue remains outside the scoped release.

No new recommendation journey, true two-session race, screenshot certificate or production signoff is claimed yet. The isolated-role provisioning adapter remains an offline candidate; planned database work means this review cannot attest that DDL is paused. The rest of the WMS transaction/exception/recovery matrix, cleanup and actual user/device pilot remain open.
