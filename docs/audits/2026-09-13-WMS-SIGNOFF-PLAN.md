# WMS Signoff Plan - September 13, 2026

## Baseline

Status: **NOT SIGNED OFF. Automated live certification, physical hardware checks and a real-user pilot are pending.**

The evidence contract and its synthetic Node tests validate reports, not application behavior. Separate live runners perform transactions and collect screenshots. A passing contract test does not establish WMS workflow completion. The first department journey and its reproduced acknowledgment blocker are documented in [the live readout](2026-09-13-WMS-LIVE-READOUT.md).

The September 11 role/screen audit reports read-only navigation on its recorded UAT build. Its screenshots and role counts are useful historical context, not transaction certification. The September 11 report generator also explicitly distinguishes isolated SQL journeys and local candidate screenshots from live cross-user writes. Those historical statements have not been independently rerun here.

Previous `full-intra` workflow names, aggregate pass counts, source-pattern tests, fixture seeds, route visits and surface-only passes receive **no completion credit**. There are no legacy aliases in this contract. New evidence must identify an exact WMS checkpoint and view, and match the independently selected run, build and environment.

## Scope And Ownership

The core evidence contract is implemented in:

- `scripts/qa/wms-signoff-contract.mjs`
- `scripts/qa/wms-signoff-contract.test.mjs`
- `docs/audits/2026-09-13-WMS-SIGNOFF-PLAN.md`

The active user-approved goal permits isolated live-UAT testing and fixes while preserving existing workflows. Production data is excluded. Every live runner must verify the target environment, use manifest-bound synthetic fixtures and existing authenticated test accounts, and document side effects and independently verified cleanup. The contract itself never grants authority or executes mutations.

## Automated Gates

The exported checkpoint registry is the executable manifest. Every UI checkpoint requires separate `desktop1440` and `mobile390` evidence. Only the explicitly service-level concurrency and injected-cleanup checkpoints omit screenshots. Service evidence cannot replace a UI checkpoint.

| Area | Required completion evidence |
| --- | --- |
| Receiving | PO-line identity; quantities and receipt actor; pending stock unavailable; short, over, damaged and duplicate receipts; exception resolution. |
| Inspection/putaway | Accepted, rejected and quarantined quantities; exact serial/lot holds; inspection evidence; accepted location; held stock unpickable; ledger reconciliation. |
| Ecommerce fulfillment | Linked demand, authorized reservation, exact pick, complete pack, courier/waybill evidence, release by someone other than the packer, shipment tracking delivery confirmation with proof, partial/cancel/retry and failed-delivery recovery. |
| Department fulfillment | Linked approved request, reservation, pick, pack, recipient/department/handover evidence, release by someone other than the packer, requester or otherwise authorized non-releaser acknowledgment, exception recovery. |
| Physical returns | Separate quarantine-first intake and QC: accepted, damaged, hold, vendor_return, unavailable. Reconcile provisional holds and stock; do not infer physical restock from a customer case decision. |
| Customer cases/replacement | Supported resolutions: replacement, refund, vendor_return, re_kit, write_off. Verify branch authority/evidence, linked replacement demand through pick/pack/release/shipment delivery, and separate customer case closure. No new repair or scrap workflow is required. |
| Inventory | On-hand/reserved/held/available reconciliation, serial/lot/location traceability, audit/export parity, count/adjustment/transfer approval, import validation and duplicate recovery, configuration/pricing boundaries. |
| Replenishment | Actual Operations recommendation without broad Procurement access; persisted quantity/rationale/actor; separate authorized Procurement acceptance and linked draft handoff; accepted/handed-off snapshots protected; failed reads and revoked access denied; dismissal on a separate fixture; duplicate handoff creates no second draft. No stock movement or purchase order is implied. |
| Roles | Isolated allowed and forbidden operations for every WMS registry role; direct API denials and record/department isolation; combined-role checks; non-WMS and unauthenticated denial. |
| Concurrency | Parallel reservation without oversell, hold versus pick/release, duplicate release/receipt/return, counts racing with stock mutation. Persist all contenders, outcomes and final ledger. |
| Recovery | Read failure versus empty success, ambiguous write timeout followed by requery, session expiry/reentry, reload/resume, duplicate prevention, injected failure and verified cleanup. |

WMS grants covered individually: `warehouse_operator`, `warehouse_supervisor`, `logistics_supervisor`, `operations`, `finance`, `bi_analyst`, `business_unit`, `marketing`, `procurement`, `pricing`, `warehouse_admin`. These are authorization assignments, not the eleven historical job-persona labels. Capture effective installed grants, not just the intended account roster. Single-role tests must isolate the WMS assignment; unrelated module assignments must be recorded in the supporting artifact.

`roles.multi` requires at least the operator and supervisor assignments on one authenticated identity. Its supporting evidence must cover combined grants, attempted packer release and bypass of existing self-approval guards, module and department boundaries, role switching and session refresh. Include deployed combined job-persona grants in that artifact; this minimum does not claim exhaustive coverage of every possible role combination.

For each fulfillment channel, the recorded releaser must differ from the **packer only**. The picker may release when another user packed. Multiple roles do not bypass the packer restriction, and changing role labels on the same user does not create independence.

Shipment completion is `warehouse.update_shipment_tracking` with `confirm_delivery`, performed by an authorized tracking actor such as a warehouse operator, not necessarily the recipient. The RPC also permits the installed `request_fulfillment` capability or order creator. The releasing operator may record shipment delivery. Require persisted `status=completed`, `shipment_status=delivered`, proof-of-delivery reference/evidence, delivery timestamp and audit actor.

Department completion is `warehouse.advance_fulfillment_order` with `acknowledge_receipt`. Exercise the requester path and verify that the releaser is denied. The installed guard also permits the order creator or actors with `request_fulfillment`/`issue_items`; it does not make requester identity the sole authorization path. Require acknowledgment reference/evidence and persisted actor/timestamp. Do not apply this non-releaser restriction to shipment tracking.

These manifest scenarios use ecommerce/replacement shipments and a department handover. The application chooses the completion action by `delivery_method`, not solely by order source: internal/event handovers and third-party transfers use acknowledgment, while shipments use tracking with proof of delivery. This contract does not change the delivery methods supported by the application.

Receiving, each fulfillment channel, customer cases with their replacements, and physical return intake/QC retain separate persisted journeys per viewport. Physical intake is not the customer case record; the contract does not invent a required foreign-key link between those workflows. Separate desktop/mobile fixtures are allowed; unrelated records cannot fill steps within a journey.

Replenishment now has three explicit checkpoints per viewport: `replenishment.recommend`, `replenishment.accept` and `replenishment.handoff`. They must share a continuous journey identity and record the corresponding action of `procurement.manage_replenishment_recommendation`. The recommendation actor needs effective Warehouse recommendation authority; the Procurement decision actor needs effective replenishment-management authority. This does not invent a new same-person prohibition for an account legitimately holding both capabilities. Still exercise a two-user handoff and an Operations-only denied decision. Source or invalid-input probes are not successful recommendation evidence. These gates were added after September 14 live testing exposed a conflicting inner authorization check; no historical role-only result receives automatic credit.

### Verified Workflow Sources

This review inspected repository implementations, not installed live SQL or new transactions. A future runner must verify the deployed build and function definitions before certifying it; source review earns no completion credit.

| Source | Existing rule preserved |
| --- | --- |
| `supabase/migrations/20260828011200_fulfillment_zero_line_backorder.sql` | Release compares `packed_by` with `auth.uid()`, not `picked_by`. Department acknowledgment blocks `released_by` and checks requester/creator/capability authority. |
| `supabase/migrations/20260820094500_converge_shipment_tracking_live_capability.sql` | `update_shipment_tracking` handles `confirm_delivery` with proof of delivery and tracking authority; no recipient or non-releaser identity requirement. |
| `supabase/migrations/20260910140118_fulfillment_handover_acknowledgment_guard.sql` | `acknowledge_receipt` is restricted to `internal_handover`, `event_handover`, `third_party_transfer`; shipments must use tracking with proof of delivery. |
| `supabase/migrations/20260721200000_cross_department_wms_persistence.sql` | Customer case resolutions are `replacement`, `refund`, `vendor_return`, `re_kit`, `write_off`, also reflected in `packages/data-kit/src/domain/wms.ts`. |
| `supabase/migrations/20260804200000_operational_flow_completion.sql` | Resolution requires a quarantine bin; refund/write-off require finance evidence; vendor return requires supplier RMA reference. Replacement can create linked ecommerce demand. Customer closure requires a resolved case, customer-service ownership, reference and evidence. |
| `supabase/migrations/20260910133142_replacement_delivery_confirmation.sql` | Current replacement wrapper preserves branch authority/idempotency and validates original/new replacement destination details when submitted. This is destination confirmation, not proof of shipment delivery. |
| `supabase/migrations/20260828033036_return_intake_atomic_quarantine.sql` | `record_return_v2` separately records customer/vendor/event physical intake, with optional allocation association, quarantine and pending inspection. Return QC supports `accepted`, `damaged`, `hold`, `vendor_return`, `unavailable`; accepted QC clears the provisional hold, other outcomes retain controlled holds. |

`returns.case-resolution` checks all supported case decision branches and their existing evidence/authority requirements; it does not reinterpret `re_kit` as a repair integration or `write_off` as a new physical scrap operation. `returns.intake` and `returns.disposition` separately verify physical custody and QC. Case resolution/closure cannot serve as proof of accepted QC, hold release or physical restock. Conversely, accepted physical QC does not close a customer case. The existing customer-close RPC does not require replacement delivery as a precondition; the certification journey separately verifies both supported operations without introducing that business guard.

## Runner API

Dependency-free ES module, with no import-time filesystem, network or application side effects:

```js
import {
  WMS_CHECKPOINTS,
  WMS_HUMAN_GATES,
  requiredWmsEvidence,
  evaluateWmsSignoff,
} from './scripts/qa/wms-signoff-contract.mjs';

const required = requiredWmsEvidence(); // Fresh { checkpoint, view } entries.
const result = evaluateWmsSignoff({
  scope: { runId, buildId, environment },
  evidence: collectedEvidence,
  humanGates: [], // Remain pending until separately reviewed human records exist.
});
```

Supply `scope` from release coordination, not by copying whichever build appears in evidence. `buildId` must uniquely identify the tested application artifact/deployment, including local candidate content when applicable; `environment` must unambiguously identify the target application and backing data environment. Never relabel an old build's evidence. `runId` identifies one controlled certification run.

Result fields: `automatedPassed`, `productionReady`, `requiredCount`, `acceptedCount`, `failures`, `pendingHumanGates`, `humanFailures`. Missing gates remain pending, not waived. Diagnostics are stable descriptive strings, not an exception-based protocol. Counts describe accepted checkpoint/view records, not features, tests or physical pilot completion. Always gate on the booleans and diagnostics, not counts alone.

Each evidence row must explicitly report:

| Field | Contract |
| --- | --- |
| `checkpoint`, `view` | Exact manifest key. Unknown or duplicate keys fail; no last-write-wins selection. |
| `scope` | `{ runId, buildId, environment, view }`, matching the independently supplied scope and required view. |
| `status`, `kind` | Exactly `passed` and `live`. Failed, skipped, blocked, mocked, SQL-fixture-only and surface-only records do not pass. |
| `operation` | Completion checkpoints require the exact `{ rpc, action }` exported on their manifest entry: shipment tracking/confirm_delivery for ecommerce and replacement shipment scenarios, advance_fulfillment_order/acknowledge_receipt for department handover. |
| `actor` | `{ id, roles }`: authenticated stable user ID and distinct nonempty role assignments. |
| `journeyId`, `actionRef` | Persisted business-chain ID and retained action trace, including failed attempts, requests, responses and actor identities. |
| `readback` | `{ scope, source: 'persisted-requery', ref, entityIds, actorId, assertions }`. Nonempty exact entity IDs, authenticated actor identity matching the checkpoint actor, and retained fresh query evidence. For read/denial checks retain the querying actor plus before/after state proving no mutation. |
| `readback.assertions` | Exactly one `{ check, expected: true, actual: true }` for every invariant in the checkpoint's `checks`. Missing, duplicate, false or unknown assertions fail. Booleans must be derived from recorded persisted values, never generated from the manifest. |
| `screenshot` | UI only: `{ scope, ref, width, height, reviewed: true }`. Actual viewport width 1440 or 390 respectively and positive integer height. Use 1440x900 and 390x844 as capture defaults. |
| `cleanup` | `{ scope, status: 'verified', ref, failurePath, residualEntityIds: [] }`. Explicit failure cleanup procedure and retained reconciliation readback; no unresolved run-owned fixtures. |

`scope` is required independently on readback, screenshot and cleanup artifacts as well as the row. Reference fields must point to retained, reviewable artifacts. A manifest is not an artifact verifier: **this pure validator does not read files, verify hashes, authenticate reporters, inspect screenshot pixels, prove timestamps or execute business assertions.** It cannot make fabricated booleans or mislabeled artifacts trustworthy.

The future runner and reviewer must verify artifact existence/content, capture timestamps and build provenance, actual screenshot dimensions, fresh authenticated read queries, cross-record business links, complete branch evidence, and before/after stock/audit values. A screenshot must show the relevant checkpoint state without loading failures, clipped controls or unreadable overlaps. `reviewed` must follow actual visual inspection. A boolean without its underlying facts is not acceptable signoff evidence even if it is structurally well formed.

Retain rejected attempts and original failed artifacts. Retry using a new run ID and a complete clean manifest; do not silently overwrite failures or combine builds. Shared run cleanup artifacts may be referenced by multiple checkpoints when they enumerate each checkpoint's fixtures and scope. Cleanup should restore/reconcile controlled stock and close or remove fixtures according to approved policy, preserve required audit records, and prove unrelated data unchanged. Any residual or cleanup failure blocks certification.

## Human Gates

Hardware and pilot are separate required attestations, not automated checkpoint aliases. Default status is **pending for both**. Passing automated evidence alone always leaves `productionReady` false.

A reviewed human gate row contains `{ id, status: 'passed', buildId, environment, reviewer, completedAt, evidenceRef, checks }`. The ID is `hardware` or `pilot`; `checks` must contain exactly every applicable exported gate check ID once. Hardware also reports `printersInUse`: when true, include `label-printers-and-rescan` from `conditionalChecks`; when false, omit that check and supply a nonempty `printerNotApplicableReason` supported by the operational review. Missing applicability is pending, not an automatic waiver. Printer integration is not an invented release requirement when printing is not operationally used.

Supply a named accountable human, dated evidence, and the tested build/environment. Different human-session run IDs are allowed; the build/environment cannot differ. Duplicate, incomplete or wrong-build attestations fail. Future release governance must authenticate the reviewer and inspect the referenced record; a string in JSON is not a signature or deployment authorization.

### Hardware Checklist - Pending

- [ ] Test actual supported scanners and phone cameras with valid, damaged, duplicate and unknown barcode/serial labels.
- [ ] Record whether label printing is operationally used. If yes, verify actual printers, label sizing, legibility, identity and rescanning; if no, record the reason as not applicable. Do not require a new printer integration.
- [ ] Exercise floor Wi-Fi loss, reconnect and ambiguous submission recovery without duplicate inventory effects.
- [ ] Check real desktop/mobile devices, touch targets, keyboard/accessibility and operational use conditions.
- [ ] Reconcile physical quantities, location, serial/lot and handoff custody against persisted inventory.

### Real-User Pilot Checklist - Pending

- [ ] Record named participants across all WMS roles, actual grants, departments, devices and independent handoff partners.
- [ ] Complete receipt exceptions, inspection and putaway using controlled physical stock.
- [ ] Complete ecommerce and department request/reservation/pick/pack workflows.
- [ ] Deny release by the packer; permit picker release when someone else packed. Complete shipment delivery through authorized tracking, and department acknowledgment through a requester/authorized non-releaser.
- [ ] Separately complete physical return intake/QC, supported customer case resolutions, linked replacement shipment delivery and customer closure. Do not treat case closure as physical restock or invent a replacement-delivery prerequisite for case closure.
- [ ] Exercise combined-role boundaries and negative direct-access cases with approved supervision.
- [ ] Observe shortage, cancellation, concurrent attempts, network failure and restart/recovery; reconcile every fixture.
- [ ] Confirm training, task clarity, support ownership, escalation and rollback/recovery procedures with participants.
- [ ] Record observations, severity and owner for every defect; close blockers and obtain accountable owner approval.

Each checked item needs participant, date, build/environment, scenario/record IDs, observed result and evidence reference. Do not prefill success from agent walkthroughs, shared automated accounts or simulated hardware.

## Release Decision

1. Freeze the candidate and identify its application build and data environment.
2. Obtain separate authorization for isolated live execution and side effects; ensure safe fixtures and cleanup.
3. Collect every automated checkpoint/view with fresh persisted evidence and reviewed screenshots.
4. Resolve failures and reconcile cleanup; rerun affected certification as a complete new scoped run.
5. Complete and review hardware and real-user pilot attestations on that build/environment.
6. Review artifacts and outstanding defects with the release owner. The contract gate is necessary, not a substitute for deployment approval, migration review or operational rollback readiness.

Offline verification command: `node --test scripts/qa/wms-signoff-contract.test.mjs`. Tests include synthetic positive manifests solely to establish that the gate can open when structurally complete; they are not eligible release evidence.
