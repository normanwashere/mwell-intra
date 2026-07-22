# Mwell Intra Live UAT Launch-Readiness Audit

**Audit date:** 2026-07-22  
**Target:** https://mwell-intra-uat.vercel.app  
**Supabase project:** `kkoitlvydytdhlpxhuah`  
**Branch reviewed:** `codex/unified-finance-module`  
**Verdict:** **NO-GO**

## Expanded Audit Charter

Audit the deployed Mwell Intra UAT as a business-critical, cross-department operating platform. Assign one reviewer to each supported persona. For every persona, test the complete rendered navigation surface and role boundaries at desktop and mobile sizes, including happy paths, validation failures, unauthorized paths, refresh, browser history, session restoration, deep links, offline behavior, empty/loading/error states, keyboard use, focus, touch targets, fixed navigation, overlap, truncation, horizontal overflow, hierarchy, accessibility, console errors, network failures, and database state.

Separate these certifications:

1. **Presentation:** the route renders and remains legible.
2. **Authorization:** the role can access only intended data and actions.
3. **Workflow:** the persona can start, continue, recover, hand off, and complete its work.
4. **Persistence:** every mutation reads back from Supabase with the correct actor and audit history.
5. **Cross-role completion:** the same business record moves through all required departments.
6. **Cleanup:** controlled QA records are removed deterministically.

The launch decision must not treat an empty page, a successful redirect, or a green static route matcher as proof of workflow completion.

## Scope And Evidence

- 11 personas, each audited independently.
- Automated route checks at 1440, 1280, 768, 390, 360, and 320 pixels.
- Manual interaction checks at 1440x900, 390x844, and 320x720.
- More than 600 screenshots under `output/persona-audit/`.
- DOM-discovered navigation crawl, not only static route lists.
- Console, network, offline/PWA, accessibility, keyboard, and geometry checks.
- Live Supabase schema, row counts, role mappings, grants, and advisors.
- Build, lint, typecheck, Knowledge Base verification, and live-contract tests.
- Safe non-mutating transaction phase on desktop and mobile.

## Executive Findings

### P0 - Launch Blockers

#### P0-1: Warehouse can create supplier POs outside governed Procurement

`/warehouse/purchase-orders` exposes **New PO** to Procurement Lead and creates a Warehouse PO directly in `ordered` status. It does not require an approved Procurement request, sourcing decision, accredited vendor, DOA route, Procurement PO, or immutable source references.

**Impact:** the documented Procurement policy and vendor-accreditation gate can be bypassed.

**Required action:** remove raw PO authoring from Warehouse. Warehouse must consume approved/issued Procurement POs and own only receipt, inspection, putaway, custody exceptions, and returns.

**Acceptance:** no Warehouse PO or receipt can exist without a governed Procurement PO and accreditation/approval history.

#### P0-2: Vendor application drafts store sensitive data only in localStorage

`/vendor/cases/:id/application` persists company, tax, contact, qualification, and declaration data in browser `localStorage`; Supabase is used only at final submission.

**Impact:** drafts can be lost, remain on shared devices, cannot recover across devices, and have no vendor-scoped RLS, version history, or audit events.

**Required action:** implement owner-scoped server drafts with autosave, optimistic versioning, explicit discard, retention rules, and immutable audit history. Remove sensitive draft payloads from local storage.

#### P0-3: Executive KPI status can report the opposite of reality

Fulfillment at 0% against a 95% target is labelled **On target** because the comparison logic treats higher values as bad for every metric.

**Impact:** leadership can receive a materially incorrect performance signal.

**Required action:** define each metric as minimum, maximum, range, informational, or unavailable. Add boundary tests for every KPI.

#### P0-4: Missing source data is presented as healthy performance

The live operational tables are empty, but Insights converts absent aggregates to zero and labels cards **On target**.

**Impact:** “no evidence” is presented as “operations are healthy.”

**Required action:** include denominator/sample count and completeness status. Empty sources must display **No data / incomplete**, never green.

### P1 - High Priority

1. **No governed live write/read/handoff/cleanup certification exists.** The safe transaction pass completed six desktop/mobile authority and surface checks, but write scenarios were skipped because the controlled cleanup credential was unavailable.
2. **UAT has no representative operating data.** DOA matrices, Procurement requests/POs/approvals/payment packs, Legal invitations/cases/documents, Warehouse locations/products/receipts/inspections/counts/fulfillment/returns/kits/re-kit records all contain zero rows.
3. **Vendor invitation governance is incomplete.** There is no authoritative invitation expiry field or demonstrated accepted/expired transition, replay denial, first-time password setup, supersession, or delivery reconciliation.
4. **Product go-live authority is not implemented.** Product has pricing/event visibility but no readiness package, decision queue, approve/reject action, conditions, evidence, versioning, or Operations gate.
5. **Price governance is incomplete.** Product can overwrite price using only product and amount; cost basis, reason, effective date, independent approval, and immutable revision history are absent.
6. **Finance has incompatible Warehouse duties.** Finance can originate cycle counts/manage inventory and later perform finance-stage stock-adjustment approval. Remove physical custody and count origination from Finance.
7. **Legal duties are over-combined.** One persona can configure invitations/checklists, review evidence, decide accreditation, manage instruments, and configure DOA. High-risk and exception dispositions need dual control.
8. **Admin role grants are not governed.** Role toggles do not require approval reference, reason, scope, effective date, or expiry; self-change appears available and fails only with a generic RPC error.
9. **No administrator audit viewer exists** despite audit capability and governance claims.
10. **Purchase-request drafts are lost on refresh.** Add server autosave, resume, idempotency, ownership checks, and explicit discard.
11. **Event lifecycle is incomplete.** Create exists, but edit, reschedule, cancel, close, reopen, transfer ownership, and controlled reason capture do not.
12. **Event scheduling validation is incomplete.** Start date is documented as required but is not enforced consistently in UI, domain, and database.
13. **Event-to-Warehouse handoff is broken.** Marketing is directed to a Warehouse event route that denies access; stock requests do not retain `event_id`.
14. **Product and Operations see role-visible dead ends.** Inventory Reports and Warehouse Events navigate to modules the signed-in persona cannot access.
15. **Leadership drill-down is unusable.** Five of seven “Open governed source” actions lead to access denial; another remains in a loading skeleton.
16. **Vendor missing-case application can hang indefinitely** on an unlabelled skeleton with no recovery.
17. **External vendors can browse internal Knowledge Base content** covering Finance, Admin, Warehouse, Procurement, governance, and internal handoffs.
18. **Protected deep-link redirects are lost after login** for Admin, Finance, Legal, Marketing, and Product routes.
19. **Offline state is unsafe or misleading.** Finance, Events, and Insights can show cached content as **Live**; Vendor can render a blank page; navigation can disappear.
20. **The route harness has false positives and incomplete discovery.** Nonexistent case/detail routes redirect to broad list pages yet pass text matchers; real DOM-visible dead ends are omitted.
21. **Mobile fixed controls obscure content.** Bottom navigation covers cards/actions at 320/390; Admin/Legal DOA save bars cover active fields; Legal review controls can cover requirement cards.

### P2 - Important Improvements

- Make Home descriptions capability-aware; several personas are promised actions they cannot perform.
- Filter My Work tabs by assigned/usable modules and distinguish no work, no access, and unconfigured.
- Replace `UAT` as page H1 with descriptive workspace titles; keep environment as a badge.
- Add user search, active/status/module filters, retired-user separation, and pagination to Admin.
- Replace crowded mobile department actions with one 44x44 overflow control and a responsive sheet.
- Standardize all operational controls at a minimum 44x44 hit area; several desktop controls are 25-40px high.
- Fix invalid/missing ARIA references, unsupported labels on generic elements, denial-page landmarks, and Escape/focus behavior in account menus.
- Add inline validation, `aria-invalid`, error descriptions, and focus/scroll to the first invalid field in Procurement.
- Add clear errors or disabled state for empty scanner submissions.
- Replace operation-route UUIDs as primary labels with human-readable names/codes.
- Add KPI reporting periods, numerator/denominator, owner, calculation definition, source timestamp, and record count.
- Separate source freshness, extraction time, reporting-window end, and completeness; repeated reads must not advance source freshness.
- Add vendor-facing support, invitation status, account manager, retry path, and correlation reference.
- Make Knowledge Base evidence responsive, zoomable, step-specific, and annotated with numbered hotspots.
- Audience-classify Knowledge Base content and enforce filtering server-side, not only in navigation.
- Update the PWA manifest to represent all Intra modules; reconsider forced portrait orientation.
- Harden CSP where feasible; current policy permits inline scripts/styles.
- Revoke unnecessary direct EXECUTE grants on private functions. The `private` schema is not currently exposed, so this is hardening rather than a reproduced API breach.

## Persona Verdicts

| Persona | Verdict | Primary blocker |
|---|---|---|
| Platform Administrator | No-go | Ungoverned grants, no audit viewer, empty DOA, mobile obstruction |
| General Employee | No-go | Request draft loss, missing detail/handoff proof, event date gap |
| Operations Associate | No-go | Event dead end and no custody transaction certification |
| Operations Lead | No-go | No live operational lifecycle and incomplete navigation crawl |
| Procurement Lead | No-go | Warehouse PO policy bypass and unresolved segregation |
| Finance Controller | No-go | Inventory origination plus finance approval; stale data shown live |
| Legal Compliance Lead | No-go | Invitation lifecycle and accreditation transaction unproven |
| Marketing Events Lead | No-go | Event-to-Warehouse handoff and lifecycle missing |
| Product Owner | No-go | Product go-live authority absent; pricing/inventory over-scope |
| Leadership Insights | No-go | Incorrect KPI status, false health/freshness, dead drill-downs |
| Vendor Representative | No-go | Local-only sensitive drafts and incomplete accreditation lifecycle |

## Security And Data Review

- Authentication and server-derived role denials worked after repairing drift in the 11 designated UAT credentials.
- Credential drift itself remains a release-process control gap; UAT accounts need governed provisioning/rotation verification.
- No anonymous grants to business-domain tables were found.
- Tracked-file secret scan found no live JWT, database password, or service credential.
- Supabase reports 10 INFO `rls_enabled_no_policy` notices. Most are intentionally fail-closed/RPC-only; document and test that intent.
- Supabase reports 153 INFO unused-index notices. Do not remove indexes before representative telemetry.
- Eleven private functions are executable by `authenticated`, and one trigger function retains PUBLIC execute. The schema is not exposed through PostgREST, but least-privilege grants should be tightened.
- Security headers are broadly present: HSTS, frame denial, MIME protection, referrer policy, permissions policy, and CSP.
- Vercel deployment/runtime logs could not be audited because the connected Vercel scope returned 403. Observability is therefore not certified.

## Code And Release Quality

- Monorepo lint and production build: **14/14 tasks passed**.
- Full typecheck: passed.
- Knowledge Base verification: **76 tests passed**.
- Safe transaction surfaces: **6/6 passed** across desktop and mobile, with no console/network errors.
- Live contract suite: **51 passed, 1 failed, 1 skipped**. The failure is a quote-sensitive source regex even though active-hold filtering exists; replace it with semantic/behavioral verification.
- Certification tools ran child processes under Node 20 despite the repository requiring Node 22+. Pin CI and local certification to Node 22 or 24.
- Representative performance, concurrency, large-list, and load behavior cannot be certified against an empty database.

## Required Launch Sequence

### Gate 1: Close P0s

1. Remove Warehouse PO origination and enforce Procurement PO lineage.
2. Move vendor drafts to Supabase with tenant isolation and auditability.
3. Correct KPI direction and no-data semantics.

### Gate 2: Establish Governed UAT Certification

1. Seed editable department DOA matrices.
2. Provision a run-scoped warehouse, bins, products, serialized units, supplier, accredited vendor, event, request, PO, return, and kit.
3. Store the UAT service credential only in a CI vault.
4. Run unique-ID create → handoff → approve → receive → inspect → putaway → allocate → issue → return/re-kit → finance-readiness workflows.
5. Verify each checkpoint through the acting persona and directly in Supabase.
6. Exercise unauthorized, stale, duplicate, replay, expiry, concurrent, refresh, and retry paths.
7. Clean all tagged data and prove cleanup.

### Gate 3: Close Cross-Role And UX P1s

Fix deep-link restoration, offline truthfulness, role-visible dead ends, event linkage/lifecycle, Product go-live, segregation of duties, governed role changes, mobile fixed-control collisions, and false-positive route assertions.

### Gate 4: Re-Audit

Repeat all 11 personas at desktop and mobile sizes. Require:

- zero P0/P1 findings;
- green build, lint, typecheck, contract, accessibility, and DOM-discovery tests;
- zero visible navigation dead ends;
- no fixed-element overlap at 320 and 390 pixels;
- successful cross-role write/read/audit/cleanup evidence;
- representative data and measured performance;
- accessible Vercel runtime logs and alerting;
- signed business-owner acceptance for Procurement, Legal, Finance, Operations, Product, and Security.

## Final Decision

The deployed UAT has a credible responsive shell, working authentication after credential repair, broad fail-closed route authorization, and a healthy build. It is **not launch-ready**. The principal risk is not visual polish: it is that policy-critical workflows are either bypassable, absent, misleading, or unproven against live Supabase. Launch approval should wait until the P0 controls are fixed and the full governed cross-role transaction certification passes.
