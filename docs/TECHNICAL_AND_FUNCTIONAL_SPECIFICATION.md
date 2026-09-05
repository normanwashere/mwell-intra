# Mwell Intra Technical and Functional Specification

## September 5 Remediation Candidate

This addendum describes the September 5 UAT implementation and follow-up candidate. Changes through `7dd30cb` are deployed, but end-to-end acceptance remains incomplete. The subsequent title-icon and outcome-layout correction requires its own matching deployment and visual verification. Earlier release evidence below retains its original boundary; main production is untouched.

- Control queues follow cursor pagination through the complete authorized result. A repeated cursor or failed later page produces an explicit retry state, never a partial-success or empty-work claim.
- Receipt inspection reconciliation consumes an inspection quantity once. The persisted procurementLineId and serialized identity distinguish repeated products on separate receipt lines.
- Task links carry exact source IDs. Quality, recorded counts, and exceptions resolve that source or show unavailable/completed status without substituting another record.
- Shared adaptive dialogs support a wide desktop size while preserving mobile sheet behavior. Contextual tooltips are rendered in a portal with measured viewport bounds.
- Queued inventory mutations are not reported as committed success. Durable intent identity and actor-scoped replay receipts protect retries; legacy unowned/unkeyed entries require reconciliation rather than automatic replay. Deploy the corresponding adapter and migration together.
- UAT migration review includes actual catalog types, function signatures, effective role validity, and negative permission tests. Local fixtures alone do not certify deployed storage, concurrency, or cross-role handoffs.
- Procurement payment evidence admission uses the effective employee capability set, not generic PO-view access or raw role templates. Requests are generation-bound so a response arriving after actor/access changes cannot expose stale evidence. Authorized read-only reviewers retain visible server errors.
- The second acceptance follow-up isolates Finance source retries within the current actor/capability scope. Valid unrelated source metrics must remain visible; stale responses and callbacks from an earlier scope must not overwrite or invalidate current data. Whole-workspace loading remains appropriate for a new authorized scope, not a single-source retry.
- Quality reconciliation prioritizes exact receipt-line/serial identities before unambiguous legacy quantities and consumes each inspection quantity only once. Conflicting duplicate identities become a recoverable queue error with mutation controls blocked, rather than crashing rendering or presenting an empty queue. Known identity conflicts are not guessed away.
- Quality control population reads have a 12-second application deadline, separate from browser-test wait limits. Inspection, hold and vendor-return populations must all complete before actions resume. Timeout/rejection exposes retry; superseded or unmounted generations cannot publish results or continue pagination. Existing repository requests are not transport-aborted, so this is cancellation of result consumption and further pages, not a claim that an in-flight HTTP request was stopped.
- Browser-audit visibility respects closed disclosure ancestors while retaining native summary controls. The audit waits for semantic loading states to settle and still fails persistent loading, source errors, and visible click interception. Expanding a disclosure and exercising its action is a separate interaction assertion.
- CI must invoke the maintained September 5 SQL regression fixtures explicitly; workspace tests alone do not run every standalone script. Quality validation opens the actual receipt group before using Inspect. Inspection/vendor-return creation evidence must come from an executed write and database readback, not a validation-only dialog or an empty queue.
- The shared header supports content-driven wrapping of its brand and bounded action group at enlarged text sizes. Validate both header and page bounds, not only the Event metric grid, at 320px with 200% root text.
- Shared page-title icons must yield a full text row when their container cannot accommodate both at the selected text size. Event outcome grids must reflow labels and values without fixed two-column crowding. Normal desktop geometry must be verified alongside enlarged-text reflow.
- Account-menu geometry must be bounded by the viewport and fixed navigation, with internal vertical scrolling and wrapping authority rows. Recalculate available space when the viewport or text layout changes. Preserve Escape/outside dismissal, focus return, and the existing authorization of menu actions.
- Notification popups share the same available-space constraint while retaining their normal preferred width. Their empty-state explanation and populated-row actions must stay reachable; a passing empty-state screenshot is not populated-action certification.
- Notification client state must be isolated by verified principal and effective access scope, including retained Home-shell cross-tab auth changes. Profile loss/change must invalidate cached rows and pending callbacks before another principal can render. Same-scope refreshes should preserve the stable component boundary. This complements RLS; it does not change database grants.
- The in-memory training repository persists procurementPoLineId on quality inspections and checks that an explicit line belongs to the receipt/product and has sufficient remaining quantity. Same-SKU, same-bin lines retain separate identities after inspection and reload. This is simulation parity, not a change to the deployed Supabase authorization boundary.
- Warehouse task navigation carries only validated due/blocked/completed status and the original encoded source ID; fixed internal return routes restore that filter. My Work source links have task-specific accessible names. Receiving validation emits structured field targets so correction links focus the exact failing control, with a labelled persistent summary and blur-triggered polite announcement.
- Forward migrations make receiving-draft and return-v2 certification boundaries explicit without changing draft ownership/versioning or return quarantine/replay semantics. Quality verification fingerprints the reviewed guarded public-to-v3-to-v2 and controlled-return implementation chain, including execution boundaries. Unexpected bodies or malformed verifier responses fail closed. The installed UAT verifier returned zero raw boundaries, no missing objects/grants, and a valid quality chain in a read-only metadata check; CI HTTP and transaction acceptance remain separate gates.

**Reviewed:** August 28, 2026 for the recovery and evidence addendum; other sections retain their documented evidence boundaries
**Procurement application behavior baseline:** `32170e425e125c63597ea8e05c6287a7cd256f5b`
**Evidence status:** schema boundary verified on UAT; standalone handbook Task 8 certification is recorded in `docs/releases/2026-08-24-OUTCOME-FIRST-HANDBOOK.md`

## Product boundary

Mwell Intra is the shared operating platform for cross-department workflows. Warehouse, Procurement, Legal, Finance, Product, Marketing, Operations, Customer Service, and platform administration use scoped modules over a shared Supabase authority model. Warehouse is a component of Intra, not a separate application.

## Runtime architecture

- Next.js shell deployed on Vercel.
- Modular React workspaces under `modules/`.
- Supabase Auth for identity and session management.
- PostgreSQL schemas, row-level security, guarded functions, and immutable activity records for live authority.
- Role and capability resolution controls routes, commands, records, and onboarding curricula.
- The standalone operating handbook is packaged with each certified release and maps guidance to current routes, roles, process diagrams and governing references.

### August 27 Receiving and Intake Controls

Procurement receiving supports a selected subset of PO lines. The existing governed receipt transaction locks the PO and validates remaining quantities; the UI does not grant new receiving authority. Per-operator receiving drafts are separate from stock records, scoped by authenticated actor and PO, and protected by optimistic revision checks. Saved scans are not evidence of receipt or inspection. Draft reads never fall back to browser storage in live mode, and changed PO balances require review.

Serial scanning reuses the camera/manual-entry component and rejects duplicates and over-capacity scans. Delivery-note image capture stores private evidence references; external delivery evidence must use HTTPS. The August 28 corrective build replaces per-line event reservation writes with one atomic batch and a persisted command identity shared by both entry points. Multi-line returns submit one validated batch with a stable intake idempotency key. An unknown result locks the original payload for recovery; only a confirmed rejection allows correction. Intake cannot authorize restocking. Marketing reservation permission does not confer stock issue or approval authority.

The versioned `warehouse.record_return_v2` command owns inventory, movement, return and provisional Quality writes. Physical serialized units use the database's `in_stock` counting model with exact active quarantine holds in the same transaction. Consequently, pending intake does not increase available-to-promise stock, and releasing one accepted serial increases availability by one. Legacy intake remains compatible with already-open clients during rollout. Marketing curriculum v2 adds a dedicated reservation assessment; publishing it does not manufacture learner completion or bypass `has_live_cap`.

### August 28 Recovery Contracts

Deployment and test status for these contracts is tracked in `docs/releases/2026-08-28-CROSS-ROLE-RECOVERY.md`; this specification alone is not evidence that a migration is installed.

- `warehouse.reserve_batch(jsonb)` accepts one event and product/purpose/quantity lines under an actor-bound idempotency key. It checks earned reservation capability, aggregate available stock and all lines before committing. Product locks protect shared stock. A stored rejected result means no allocation lines committed; a replay returns the original outcome.
- Return command outcomes distinguish success, confirmed rejection and unknown transport outcome. Recovery retains the submitted payload and command identity. A new rejection on an uncertain replay does not prove an earlier attempt failed; the recovery path remains conservative.
- `EvidenceCapture` reconciles upload completions against the latest controlled list and a semantic record/session generation. Removed files stay removed, partial successes survive other upload failures, stale callbacks cannot reach another record, and parents receive upload-pending state to gate commits.
- Long-form drafts are scoped to the authenticated operator and workflow. The new Returns/order-intake drafts are browser-local, unlike governed PO receiving snapshots. They require explicit resume, guard conflicting tab revisions, and never grant business authority or automatically resubmit. Do not describe these drafts as shared or cross-device storage.
- Shared document controls distinguish private uploaded references, authorized registered documents and secure external links. Business evidence and preview authorization must be enforced server-side; a client file picker is not sufficient. The scoped Finance/Event evidence service retains durable registration IDs rather than expiring preview URLs.
- `POST /api/evidence` verifies the session and same-origin request, limits file bodies to 4 MiB plus bounded multipart overhead, checks MIME signatures, and asks actor-scoped RPCs to authorize and register private objects. The `documents/business-evidence/` prefix denies direct authenticated Storage access. Preview links expire after five minutes and are never persisted as business evidence. The limit stays below the [Vercel Functions request-body limit](https://vercel.com/docs/functions/limitations).
- Warehouse access recovery separates missing assignment, missing certification and unavailable/stale access state. It routes the user to the exact onboarding requirement when known without changing permissions.
- Finance reconciliation writes its status, reconciler identity and timestamp atomically before the existing Event lineage trigger runs. The existing wrapper chain still validates separate actors, current row versions, canonical source/evidence bindings and an attributable audit record.

## Standalone handbook architecture

### Four-mode presentation model

The standalone handbook exposes four public modes in this order:

1. **Home** starts with the question “What do you need to do?”, frequent operational outcomes, role entry, specialist support, and recent guides.
2. **Tasks** contains exactly 13 canonical end-to-end guides for currently implemented workflows.
3. **Roles** contains exactly 11 canonical persona guides with workspaces, authority, prohibited actions, handoffs, recovery, simulation, and sign-off evidence.
4. **System** contains administration, architecture/data, infrastructure/continuity, security/governance, release/QA, imports, training readiness, and the governed source register.

Home, Tasks, Roles, and System are presentation modes, not database roles or application modules. The source registry remains independent from this navigation so one governed source may support several user-facing guides without duplicating its canonical body.

### Source and guide separation

`scripts/docs/handbook-catalog.mjs` is the fail-closed registry for every maintained Markdown and CSV source. Missing, duplicate, stale, or unclassified sources fail generation. `scripts/docs/handbook-guides.mjs` separately defines Home, task, role, and System presentation contracts. The generator composes exact source sections into operational guidance while rendering every governed source body exactly once under System source references. Document controls link back to that canonical body and expose owner, version, checksum, release identity, and review date only when opened.

The generated artifact is `docs/manual/index.html`. It embeds CSS, runtime JavaScript, Mermaid, the typed search index, the legacy-route map, and certified screenshots so it can operate without application authentication or network access. It contains no live private data or Supabase credential.

### Canonical routing and migration

The runtime owns one canonical route with the fields `mode`, `guide`, `heading`, `query`, and `scope`. Explicit URL state overrides local state. Browser Back and Forward, reload, per-guide scroll, disclosures, recents, diagram view/zoom/pan, theme, and search state are persisted in `mwell-intra-handbook:v3` without reloading the document.

Every maintained legacy `tab`, `article`, and heading deep link is generated into `LEGACY_ROUTES`, translated to the nearest canonical destination, and shown with a non-blocking moved-link notice. Invalid routes recover to Home with a visible search action. The one-time v2 migration removes the old record only after translating an exact known route.

### Search and discovery

Search indexes Task, Step, Decision, Role, Troubleshooting, and System-reference records. Exact operational intent, action, and governed synonym matches rank before governance and release evidence for ordinary user queries. The controlled synonym model includes the eight literal first-use prompts for receiving, ecommerce fulfillment, vendor accreditation, purchase requests, unknown returned serials, inventory variance, Operations Associate authority, and infrastructure/recovery guidance. Results show type, role/module context, excerpt, match reason, and an exact same-document destination. Controlled no-result recovery offers common task terms, role browsing, and the System filter without leaving an empty panel.

### Responsive, accessibility, and print contract

- Acceptance widths are 1440, 1280, 1024, 768, 430, 390, 360, and 320 CSS pixels.
- Desktop uses contextual navigation, the reading canvas, and a bounded page outline. Compact layouts move modes, theme, print, and contents into reachable drawers.
- Keyboard operation covers tabs, search, guides, drawers, disclosures, screenshot viewer, diagrams, and print. Focus returns to the invoking control when a compact surface closes.
- Touch targets are at least 44 by 44 CSS pixels. Serious and critical Axe findings, page-level overflow, clipped content, and sticky-control overlap fail browser certification.
- Mermaid provides fitted task diagrams, zoom controls, overview/role/decision perspectives where available, and a complete text equivalent with branches and terminal outcomes.
- Certified screenshots use responsive `<picture>` sources, visible numbered interaction targets, a full-screen viewer, descriptive alternatives, focus trapping, Escape, and trigger-focus return.
- Print supports the current guide, current mode, or complete handbook without mutating saved disclosure state.

### Handbook evidence and attestation

Stage evidence is governed by:

- `docs/manual/assets/knowledge-base/task-stage-evidence.json` for 52 stage bindings and desktop/mobile hashes;
- `docs/manual/assets/knowledge-base/task-stage-ci-attestation.json` for the independently anchored GitHub run response;
- `scripts/qa/handbook-evidence-targets.mjs` for workflow-specific controls and source context;
- `scripts/docs/verify-handbook-ci-attestation.mjs` for repository, workflow, run, conclusion, head SHA, branch, attempt, timestamp, field-set, and digest validation;
- `outputs/handbook-visual-review/` for current Task 8 viewport captures.

The strict model rejects wrong hosts, routes, roles, targets, contexts, paths, hashes, reuse, stale timestamps, future timestamps, non-attested commits, fake runs, failed runs, and jointly mutated approval records. Current commands and exact results are maintained in `docs/releases/2026-08-24-OUTCOME-FIRST-HANDBOOK.md`.

### Task 8 certification result

The current model contains 35 maintained sources, four public modes, 13 task guides with 52 stages, 11 role guides, 48 decisions, 96 branches, 27 terminal outcomes, and 368 legacy-route migrations. Eighteen routes and two release sources were added on August 28; September 5 adds three candidate guides, one follow-up release note and 37 article/heading routes across the updated maintained sources. The original August 24 unit trio passed 81 of 81 tests; strict evidence coverage and provenance returned zero warnings and zero errors, and the independent CI attestation verified. That original eight-project browser suite passed 116 tests with 100 project-conditional skips and zero failures in 19.6 minutes. Its 24 captures cover light, dark, and print at 1440, 1280, 1024, 768, 430, 390, 360, and 320 CSS pixels; those historical results are not a fresh certification of later changes. The August capture evidence is stale under the unchanged seven-day age gate as of September 5; historical-fixture unit checks do not recertify it.

Repository verification passed: documentation build/check from all 29 sources, lint with 15 of 15 Turbo tasks and no errors, typecheck with 15 of 15 Turbo tasks, and release-documentation verification with no operational source changed. The three existing lint warnings are recorded by exact file and line in the release record. Local pnpm commands emitted the declared-engine warning because certification ran on Node `v20.18.1` and pnpm `9.15.9` while the repository requires Node 22 or newer and pnpm 10.

## Procurement policy contract

### Source and activation

- The canonical operating source is `mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx`, SHA-256 `51F4E381CF7DEC6A1950867C4839750078DB08D603A5DE8AA54B63D12F6D1239`. The source identifies itself as an updated visual draft for management, Legal, Procurement, Finance and requester review.
- `MPIC Procurement Policy February2025.docx` is an incorporated reference. Its controls may be inherited only where the canonical mWell source does not replace them, and inherited values must retain visible provenance.
- The mWell operating profile stays in draft while the source document status is draft. Server and client validation reject activation until Procurement records the source as approved.
- PHP 1,000,000 is the solicitation boundary in the canonical mWell source: RFQ below it when clear and comparable; RFP at or above it, or at any amount for named complexity and risk triggers.
- The current effective department DOA is the sole source of named Mwell approval authority. MPIC titles, named people, cost-center annexes, and source approval tables are never projected into Mwell authority without an activated profile/DOA decision.
- The direct MPIC variance approvers, the current Mwell code stage labels, and authorized local decision stages are separate facts. Operating controls use neutral first and second independent variance decisions until Mwell policy/DOA owners authorize the local stages.
- The incorporated MPIC reference caps a bid extension at seven calendar days. The application and migration use calendar-day semantics and expose the inherited source.
- The additive procurement migration is intentionally unapplied at this baseline. Source approval, authorized local variance-stage mapping, controlled migration rehearsal and UAT certification remain release gates. Profile declarations, tests or handbook output do not prove live database activation, deployment or UAT certification.

### Three-axis route model

| Axis                  | Values                                                                                                             | Derivation and enforcement                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solicitation document | `rfq`, `rfp`, `none`                                                                                               | RFQ derives below PHP 1,000,000 when clear and comparable. RFP derives at PHP 1,000,000 and above, or for complex, technical, strategic, high-risk, data-sensitive or non-comparable work at any amount. Importation alone does not force RFP. An approved exception may derive none when policy permits. |
| Procurement mode      | `competitive_bidding`, `sole_source`, `repeat_order`, `emergency_purchase`, `petty_cash`, approved other exception | Competition is default; each exception requires server-validated eligibility, evidence, owner review, and current DOA                                                                                                                                                                                     |
| Governance tier       | `standard`, `formal_bid`, `high_risk`, plus effective DOA route                                                    | Amount, complexity, technical/strategic risk, data sensitivity, category, active profile and current DOA determine control depth; route reasons preserve every triggering fact                                                                                                                            |

A clear, comparable goods or service request below PHP 1,000,000 may use RFQ. Any request at or above PHP 1,000,000 uses RFP, and a lower-value request also uses RFP when a named complexity/risk trigger is present. Requirement kind still governs scope, acceptance and reporting. Compatibility projections such as legacy `sourcing_method` do not replace the three authoritative axes.

### Canonical process spine

The policy process is: define need; submit request; confirm path; source vendors; check accreditation; evaluate; recommend award; approve; issue PO/contract; deliver and close obligations; prepare payment handoff; process payment; close file. The application may expose more granular state transitions for package issue, failed-bid recovery, acknowledgement, inspection, quality recovery and Finance review. Those are system-expanded states mapped to the canonical 13 steps.

### Sourcing and award controls

- A versioned solicitation package is delivered equally to three to four accredited vendors, with recipient, package hash/version, deadline, acknowledgment, clarification, extension, and notification evidence.
- Sealed-bid opening requires at least three usable responses. Failure creates an explicit failed-bid state; recovery is equal-notice extension/requote or an independently approved, evidence-backed insufficient-bids decision.
- Planning SLA ranges from the canonical mWell source are operating targets, not silent approval authority: petty cash 1-3 working days, RFQ 5-7, RFP 15-25, Direct Award 5-10, accreditation 5-10, importation adds 10-30 and payment readiness 3-5. Their start conditions and any inherited MPIC timers must be versioned and shown with source provenance.
- The incorporated MPIC timing controls represented by the current profile include at least seven working days for the standard bid window, no more than seven calendar days for an extension, 24-hour RFQ acknowledgment, 48-hour clarification, 48-hour tabulation, five-working-day technical evaluation and 48-hour PO acknowledgment.
- Commercial tabulation and technical evaluation are separately attributable. The system selects no automatic winner; Procurement records a best-value recommendation across the source criteria.
- A recommendation variance requires written requester justification, a first independent variance decision, and a second independent variance decision. Each neutral stage must be authorized by Mwell policy/DOA owners and assigned through the effective DOA before use; MPIC role names or current code labels do not provide that authorization.

### Exception, commitment, receiving, and payment controls

- Sole source, repeat order, emergency purchase, petty cash, and other exceptions are explicit procurement modes, not requester flags. Each denied eligibility check returns to competition or a documented correction path.
- The represented source values are PHP 250,000 and one year for repeat-order eligibility, PHP 2,000 for petty cash, PHP 50,000 for source-policy invoice/PO support, and six months for vendor probation. These values are policy parameters, not Mwell approval limits.
- PO/agreement creation is blocked until request, vendor eligibility, sourcing/recovery, award, protection, and current DOA evidence pass. Vendor acknowledgment and open delivery/acceptance obligations enter monitored queues.
- Financial-protection assessment records down-payment, supply/delivery performance, development performance and warranty, third-party liability, contractor-equipment and project-specific insurance requirements. The general source references 30% performance and 10% warranty values where applicable; the system must not invent a guarantee, percentage or waiver without the approved profile/contract basis.
- Warehouse or the service owner creates receipt, QC, custody, and acceptance evidence. Non-conformance routes to rejection, quarantine, replacement, warranty, RMA/credit, and payment hold.
- Procurement prepares a versioned payment-readiness pack. Finance recomputes invoice, approved commitment, accepted quantity/value, tax/withholding, foreign-vendor, variance, vendor-eligibility, and evidence-version checks before its decision.
- Goods accepted value is server-derived from exact accepted PO-line quantities and governed PO-line unit prices. The request, active DOA matrix, and assignments use the canonical department identity; case drift cannot silently select another authority path.
- `core.departments.code` is the canonical authority key. The DOA editor reads active directory entries instead of accepting free text. Database trigger boundaries canonicalize matrix values, synchronize every assignment to its parent matrix, reject unknown/inactive departments, and preserve the independent maker-checker activation contract. UAT temporary matrices provide exactly one unbounded named assignment for each supported tier (`dept_head`, `procurement_head`, `legal`, `finance`, and `final_approver`) so every derived route is executable during certification; governed Admin/Legal revisions replace this temporary baseline.
- The governed `procurement.save_doa_matrix` wrapper delegates to an isolated private policy function. Forward migration `20260823210000_repair_doa_save_runtime.sql` restores executable SQL `COALESCE` expressions after department canonicalization, reasserts private-function grants, verifies authenticated wrapper execution, and requests a PostgREST schema refresh. The migration never grants normal users direct access to the private policy.
- The DOA editor keeps validation at the field boundary: invalid Department, Version, or named-assignment input is rendered inline with `role="alert"`/`aria-invalid`, and the client focuses and scrolls the first invalid control into view. This behavior is required at desktop and mobile widths because the mobile save bar and primary navigation remain sticky while the editor spans multiple screens.
- In live Supabase mode, Procurement Department and Cost Center controls retain a stable select element while `warehouse.department_request_options` loads. The controls remain disabled until the directory is ready and fail closed with an inline recovery message on read failure; the live form cannot fall back to unrestricted text entry because of network timing or viewport speed.
- Procurement category and requirement-classification tiles use a native radio contract with a full-card pointer/touch hit surface and visible keyboard focus. The hidden form control owns the tile surface, preventing child text from intercepting selection on desktop or mobile.
- File closure requires payment readiness, delivery closure, resolved quality/variance/warranty obligations, and retained evidence; payment alone does not close the procurement file.

## Warehouse fulfillment contract

### Ecommerce order intake

- Orders may be entered in the UI or imported with the controlled CSV template.
- Controlled values are used for sales channel and payment method.
- Payment reference and Maya status are retained when applicable.
- Address presets populate province, postal code, and service area; operators confirm the final address.
- Product owns the selling price. Warehouse receives a read-only assigned price and cannot override it.
- CSV export emits one row per order line with order, customer, address, payment, product, commercial, dispatch, handover, and audit data.

### Bundles

- Bundle status is explicit and is not inferred from quantity.
- Every bundle quantity receives its own generated set ID.
- Every serialized component is scanned and associated with the correct set before release.

### Pick, pack, and dispatch

- Operators scan the required rack or bin before stock units.
- Serialized products require exact unit scans; duplicate, wrong-product, wrong-location, and unavailable units are rejected.
- Packaging supplies, waybill, courier, dispatch state, proof, and generated handover reference remain attached to the order.
- Navigation surfaces pending Fulfillment and Allocation counts on desktop and mobile.

### Returns

- Camera and manual serial capture are supported.
- A recognized serial resolves to its original picked release and order.
- An unmatched serial remains unresolved and must be quarantined for investigation.
- Downstream replacement, refund, supplier, Finance, and customer-closure evidence remains governed by role.

### Receiving

- PO and delivery-receipt references are visible operational inputs.
- Serialized and bulk items follow distinct quantity and identity validation.
- Inspection evidence and disposition govern putaway eligibility.
- Delivery-status writes use the released Supabase schema and scoped command permissions.

## Security and authority

- The browser receives only public Supabase configuration; service-role credentials remain in vaulted CI or server-only environments.
- Live mutations require authenticated capabilities and database enforcement.
- Test mutations are restricted to the approved UAT project and deterministic run IDs.
- Audit automation independently verifies persistence, handoff state, and cleanup.
- Vendor invitation delivery requires production-grade custom SMTP and monitored rate limits.
- Push certification exercises invitation persistence, case linkage, expiry, replay denial, and access-state controls without requiring external delivery. A manually requested desktop canary sets the fail-closed external-delivery gate and must persist `sent`, Auth identity, expiry, and link-generation evidence.
- UAT preparation fails before browser testing unless the exact active Mwell profile, MPIC parent lineage, approved filenames and SHA-256 identities, 16 control values and sources, activation event, and independent maker/checker identities match the controlled baseline.

## Release and documentation controls

Every operational release must update:

1. Standalone operating handbook content and diagrams.
2. User manual.
3. Training and operations manual.
4. This technical and functional specification.
5. Training and handover content.
6. A dated release note.

CI compares operational source changes with this documentation set. `pnpm docs:build` compiles the maintained sources and embedded screenshots into the searchable, printable, self-contained `docs/manual/index.html`. `pnpm verify:release-documentation` rejects a release when that HTML no longer matches its sources. UAT certification generates a commit-bound manifest and bundles the consolidated HTML with current desktop/mobile audit screenshots. Production deployment is blocked when required documentation is stale.
