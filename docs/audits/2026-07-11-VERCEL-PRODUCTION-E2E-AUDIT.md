# Mwell Intra Vercel Production E2E Audit

**Environment:** https://mwell-intra.vercel.app
**Deployment:** `dpl_BorKsVN2zgMoAzHWpP6Z8Yj1pSt9`
**Audit evidence:** `test-results/full-intra-live-e2e-results.json`
**Executed:** July 11, 2026 (Asia/Singapore)

## Verdict

**Not production-ready.** Authentication, role isolation, Procurement read paths, Legal read paths, Vendor Portal, and the responsive shell largely work. Warehouse is unusable against the live database, Legal cannot send vendor invitations, Procurement cannot progress through governed submission without an active DOA matrix, three required warehouse test identities are absent, and narrow mobile workflows contain blocking overlaps/overflow.

## Coverage

- 20 declared role types across 6 viewports: 1440, 1280, 768, 390, 360, and 320 pixels.
- 120 independent login sessions; 102 authenticated and 18 failed because three accounts are missing across six viewports.
- Common-route authorization checks for Home, Warehouse, Procurement, Legal, Vendor, and Admin.
- Role routes for Warehouse, Procurement, Legal, Vendor, Finance, and Platform Admin.
- Live mutation/read-back: Procurement draft creation and Legal vendor invitation.
- DOM checks: blank states, expectation misses, horizontal overflow, control overlap, dead links, unlabeled controls, console errors, and failed Supabase/Next responses.
- Screenshot evidence in `docs/manual/assets/live-20260711/`.

## Findings

### P0 - Warehouse live schema contract is broken

Every authenticated warehouse operating role receives repeated 400/404 responses. The visible failure is `lots: column lots.expiry_date does not exist`. Additional failing resources include `products`, `cycle_counts`, `receipts`, `operation_types`, and `operation_routes`. This blocks receiving, bins/storage, inventory, allocation, returns, cycle count, finance, BI, pricing, and event workflows.

**Action:** Diff generated warehouse client queries against the live `warehouse` schema, add or map the missing columns/tables, confirm Data API exposure, regenerate types, and run write/read-back workflows for receiving, putaway, event allocation, issue, return, and count before launch.

### P0 - Vendor invitation delivery is not configured

`POST /api/legal/vendor-invites` returns 503 on every viewport. Vercel lacks `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`; the route correctly fails closed.

**Action:** Rotate the service-role credential exposed during setup or create a modern Supabase secret key. Store it only in Vercel Production, set `APP_URL=https://mwell-intra.vercel.app`, redeploy, and repeat invitation, email delivery, password setup, vendor submission, correction, and re-invitation tests.

### P0 - No active department DOA matrix

Live query result: `0` active DOA matrices. Draft creation works, but governed request submission must fail closed because no department approval ladder can be derived.

**Action:** Legal Admin or Platform Admin must configure and activate each launch department's matrix. Verify exact named approvers, amount bands, category overrides, effective dates, and separation of configuration and approval authority.

### P1 - Required role identities are missing

The following expected profiles do not exist and fail login on every viewport:

- `intra.test.wh.business.unit@mwell.com.ph`
- `intra.test.wh.procurement@mwell.com.ph`
- `intra.test.wh.warehouse.admin@mwell.com.ph`

**Action:** Provision them through the governed test-user process with one scoped warehouse role each, then rerun the complete role matrix.

### P1 - Procurement wizard is blocked at 320px

The first-step Continue button times out because the sticky wizard action bar and bottom navigation compete for the same touch area. `/procurement/requests/new` also horizontally overflows at 320px.

**Action:** Position the action bar above `safe-area-inset-bottom` plus the mobile navigation height, reserve matching content padding, collapse category choices to one column at 320px, and add a real-device click test.

### P1 - Mobile navigation overlaps operational controls

At 320-390px, the fixed navigation intercepts or visually covers list rows, information controls, export actions, Legal case controls, and form option groups. This affects Procurement Officer/Admin and Legal Reviewer/Compliance/Admin most frequently.

**Action:** Define one shared mobile content inset; ensure sheets, sticky actions, and module tabs consume it. Add center-point hit testing and screenshot assertions to every mobile route.

### P1 - Platform Admin overflows at 320-360px

Platform Admin overflows on Home, denied department routes, and `/admin/users`. The users page renders all 36 accounts as one very long list with no compact search-first workflow.

**Action:** Keep the bottom tab count fixed, move secondary admin destinations into More, use searchable/paginated user results, and open role editing in a full-height sheet.

### P1 - QA data pollutes production queues

The live database contains 85 `Audit %` procurement drafts and 76 `Audit Vendor %` cases. Full-page captures show operational lists dominated by test records.

**Action:** Add `test_run_id`, `is_test`, and expiry metadata; exclude test records by default; provide a reviewed cleanup/archive job; never use untagged production records for recurring E2E.

### P1 - Requested end-to-end business certification is incomplete

The existing live runner verifies routes plus two mutations only. Warehouse blockers prevent receiving/bin/event simulations. Legal delivery prevents vendor onboarding. No active DOA prevents submission-to-approval. PO authoring, finance review, acceptance, and payment readiness were not safely reachable as a complete chain.

**Action:** After P0 fixes, execute one traceable transaction ID through vendor invite -> accreditation -> request -> sourcing -> DOA approvals -> PO -> receipt/acceptance -> finance handoff, plus rejection, correction, duplicate, stale-session, unauthorized, offline, and concurrency variants.

### P2 - Production environment validation was absent before deployment

The first deployment had empty Supabase public variables and rendered Configuration Missing. The audit repaired these values and redeployed.

**Action:** Add a pre-deploy gate that rejects empty required environment variables and a post-deploy authenticated canary before alias promotion.

### P2 - Shared audit credential was exposed

The shared audit password appeared in a screenshot. A short-lived Vercel OIDC token also appeared.

**Action:** Rotate the audit password after this run, delete the screenshot from operational channels, use a secret manager, and prefer per-run credentials with automatic expiry.

## Proven Working

- Live Supabase sign-in for 17 of 20 declared role types.
- Role-scoped denial on unauthorized module routes.
- Platform Admin users/RBAC route on desktop/tablet.
- Vendor Portal accreditation read path.
- Procurement requester/officer/approver/finance/admin read routes.
- Procurement draft write/read-back at 1440, 1280, 768, 390, and 360 pixels.
- Legal reviewer/compliance/admin read routes.
- No desktop/tablet horizontal overflow or overlap outside the warehouse error state.

## Recommended Launch Sequence

1. Rotate exposed credentials and enable Supabase leaked-password protection.
2. Repair Warehouse schema/client contract and run warehouse transactional tests.
3. Configure the Legal invitation server secret and verify actual email delivery.
4. Activate department DOA matrices and verify named approver routing.
5. Provision missing role identities.
6. Fix mobile navigation/action insets and Admin density.
7. Archive or hide QA records and introduce run-scoped cleanup.
8. Rerun the full matrix and one complete cross-department transaction.
9. Promote only after security/performance advisors and the authenticated canary are clean.
