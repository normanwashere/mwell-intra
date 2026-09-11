# Task-first Coverage Inventory

Date: 2026-09-06; inventory updated September 12 for the shared workspace release, including desktop Hide navigation / Show navigation. Scope: current knowledge inventory, including candidate instructions on existing feature routes. A feature's existing live classification does not certify its new candidate controls as deployed. NOT a release sign-off or completed Task11 pilot. Local screenshots do not establish live exact-control certification.

## Exact Baseline

68 features: 59 live, 0 limited, 9 coming soon. 294 documented controls: 285 on live-classified features and 9 non-executable roadmap controls. 26 flows, 58 decision nodes, 14 distinct policy-reference strings, 53 existing evidence records. Zero unresolved mapped flow/role targets and zero graph-validator errors in the current inventory.

All 285 controls on live-classified features have written behavior/validation/result and an owned feature reference. **Zero exact control-name/hotspot evidence matches.** This does not mean 53 images are absent: their recorded scope does not establish every control. All 294 inventory rows remain unverified for release evidence. The validator reports 290 missing action-evidence bindings, including 5 existing flow-node bindings. No new screenshots, capture dates or acceptance states were fabricated.

The snapshot below is intentionally exact. Changes require reviewing this inventory and its test, not reducing expected counts or treating a new control as implicitly verified. The inventory is current content, not a second task catalog.

Regenerate the table and JSON snapshot with `node scripts/docs/build-task-coverage-snapshot.mjs`; check freshness with the same command plus `--check`. Review the narrative counts and exact expectations in `apps/shell/lib/knowledge/coverage.test.ts` alongside each inventory change. This generator does not change screenshot metadata or the separate certification manifest.

## Mapping and Limitations

- coverage.ts retains the existing module-owned route manifest checks; validateTaskCoverage uses the existing pure graph edge helper for decision authority, branch destinations, orphan nodes, closed cycles/terminal reachability. It does not import the filesystem release validator into the client feature catalog. Terminal reachability does not prove a finite business retry bound on every optional loop; full existing release graph validation remains required.
- Every control maps to its existing feature reference, not a fabricated task ID. TaskCatalog/search/recommendation ownership stays with integration. Flow IDs are exact existing references, not guessed by title.
- Runtime inventory also includes owner, roles, capabilities, routes, validation prerequisite, field definitions, expected result, recovery and controlled policy strings. Next-owner candidates derive ONLY from existing handoff destinations; empty means undocumented, not invented. Feature-level validation is not an independently verified record-state predicate.
- ReviewedAt/content fields are metadata, not human sign-off. unverified=true is deliberate even with matching hotspots: artifact hashes, freshness, deployed commit, capture state and rendered visual review stay in existing evidence validators and post-freeze QA.
- No policy versions/thresholds copied from assumptions. The controlled references below remain authoritative. Human process owners must review per-control mapping and input/handoff precision before 100% coverage can be claimed.
- Missing documentation/evidence: exact control captures and per-control task/next-owner review remain open. Business functionality: no missing feature was invented. UI behavior: no browser tests in this task. Stale evidence: no recapture until main freeze and exact deployment verified.

## Shared Guide Change

FeatureGuide retains Task guide/Control reference and existing deep-link section IDs. Order: purpose/outcome and access/prerequisites; existing flow nodes/owners/labeled branches; control steps; actual evidence or explicit unverified message; result/handoff/recovery; secondary fields/data/status/policy reference. Controls are not falsely described as one mandatory linear sequence.

StepWorkspace retains exact branch callback identity and permission behavior. Title/prerequisite precede evidence; result/recovery and next-owner labels follow; database details are secondary. Coming-soon workflows do not offer an execution link. No server authority, mandatory requirement or certification changes.

## Feature Inventory

| Feature reference | Availability | Controls | Routes | Content owner | Existing flows |
| --- | --- | ---: | --- | --- | --- |
| feature-shell-home | live | 5 | / | Platform | identity-and-access |
| feature-sign-in | live | 3 | /login | Platform | identity-and-access |
| feature-reset-password | live | 2 | /reset-password | Platform | identity-and-access |
| feature-knowledge-library | live | 5 | /knowledge | Platform | Reference only |
| feature-role-onboarding | live | 4 | /onboarding | Platform | identity-and-access |
| feature-vendor-onboarding | live | 3 | /vendor/onboarding | Legal | vendor-accreditation |
| feature-offline-status | live | 2 | /~offline | Platform | exception-and-recovery |
| feature-my-work | live | 6 | /work | Platform | exception-and-recovery |
| feature-events-workspace | live | 4 | /events | Events Operations | event-intent-and-fulfillment, event-fulfillment |
| feature-insights-workspace | live | 8 | /insights | Data and Insights | exception-and-recovery |
| feature-product-governance | live | 5 | /product | Product | product-launch-governance, pricing-and-costing, exception-and-recovery |
| feature-admin-governance | live | 3 | /admin | Platform | administration, identity-and-access, doa-governance, access-recertification-offboarding, audit-incident-handling |
| feature-admin-users | live | 3 | /admin/users | Platform | identity-and-access, administration |
| feature-admin-audit | live | 7 | /admin/audit | Platform | administration, identity-and-access, audit-incident-handling |
| feature-admin-departments | live | 5 | /admin/departments | Platform | administration, identity-and-access, doa-governance |
| feature-admin-doa | live | 5 | /admin/doa | Platform | doa-governance, administration, procure-to-pay |
| feature-warehouse-dashboard | live | 6 | /warehouse | Warehouse | warehouse-setup, receive-to-putaway, quality-disposition, event-fulfillment, returns-reconciliation, cycle-count-adjustment, pricing-and-costing, exception-and-recovery |
| feature-warehouse-scan | live | 3 | /warehouse/scan | Warehouse | receive-to-putaway, event-fulfillment, returns-reconciliation, cycle-count-adjustment |
| feature-warehouse-tasks | live | 3 | /warehouse/tasks | Warehouse | receive-to-putaway, quality-disposition, event-fulfillment, returns-reconciliation, cycle-count-adjustment, exception-and-recovery |
| feature-warehouse-inventory | live | 5 | /warehouse/inventory | Warehouse | receive-to-putaway, quality-disposition, event-fulfillment, returns-reconciliation, cycle-count-adjustment |
| feature-warehouse-product-detail | live | 8 | /warehouse/inventory/:id | Warehouse | receive-to-putaway, quality-disposition, returns-reconciliation, cycle-count-adjustment, pricing-and-costing |
| feature-warehouse-receiving | live | 5 | /warehouse/receiving | Warehouse | receive-to-putaway, quality-disposition |
| feature-warehouse-allocations | live | 5 | /warehouse/allocations | Warehouse | event-fulfillment, returns-reconciliation, allocation-event-return |
| feature-warehouse-fulfillment | live | 17 | /warehouse/fulfillment | Warehouse | outbound-fulfillment, event-fulfillment, receive-to-putaway, returns-reconciliation, procure-to-pay, pricing-and-costing |
| feature-warehouse-returns | live | 4 | /warehouse/returns | Warehouse | returns-reconciliation, allocation-event-return |
| feature-warehouse-storage | live | 5 | /warehouse/storage | Warehouse | warehouse-setup, receive-to-putaway |
| feature-warehouse-events | live | 4 | /warehouse/events | Warehouse | event-fulfillment, allocation-event-return |
| feature-warehouse-event-detail | live | 6 | /warehouse/events/:id | Warehouse | event-fulfillment, returns-reconciliation, allocation-event-return |
| feature-warehouse-procurement-planning | live | 6 | /warehouse/procurement | Warehouse | procure-to-pay, receive-to-putaway |
| feature-warehouse-purchase-orders | live | 5 | /warehouse/purchase-orders | Warehouse | procure-to-pay, receive-to-putaway |
| feature-warehouse-cycle-counts | live | 5 | /warehouse/cycle-counts | Warehouse | cycle-count-adjustment |
| feature-warehouse-quality | live | 7 | /warehouse/quality | Warehouse | quality-disposition, receive-to-putaway, returns-reconciliation |
| feature-warehouse-approvals | live | 4 | /warehouse/approvals | Warehouse | cycle-count-adjustment, quality-disposition, pricing-and-costing |
| feature-warehouse-exceptions | live | 5 | /warehouse/exceptions | Warehouse | exception-and-recovery, receive-to-putaway, quality-disposition, returns-reconciliation, cycle-count-adjustment |
| feature-warehouse-finance | live | 10 | /finance | Finance | receive-to-putaway, returns-reconciliation, cycle-count-adjustment, pricing-and-costing |
| feature-warehouse-pricing | live | 4 | /warehouse/pricing | Warehouse | pricing-and-costing |
| feature-warehouse-data | live | 6 | /warehouse/data | Warehouse | receive-to-putaway, event-fulfillment, exception-and-recovery, returns-reconciliation, cycle-count-adjustment, pricing-and-costing |
| feature-warehouse-reports | live | 5 | /warehouse/reports | Warehouse | receive-to-putaway, event-fulfillment, exception-and-recovery, returns-reconciliation, cycle-count-adjustment, pricing-and-costing |
| feature-warehouse-suppliers | live | 4 | /warehouse/suppliers | Warehouse | procure-to-pay, vendor-accreditation, warehouse-setup, receive-to-putaway |
| feature-warehouse-locations | live | 4 | /warehouse/locations | Warehouse | warehouse-setup, receive-to-putaway, event-fulfillment |
| feature-warehouse-imports | live | 5 | /warehouse/imports | Warehouse | warehouse-setup, administration |
| feature-warehouse-operation-routes | live | 5 | /warehouse/operation-routes | Warehouse | warehouse-setup, administration |
| feature-procurement-requests | live | 3 | /procurement | Procurement | procure-to-pay |
| feature-procurement-request-create | live | 5 | /procurement/requests/new | Procurement | procure-to-pay, vendor-accreditation |
| feature-procurement-request-detail | live | 6 | /procurement/requests/:id | Procurement | procure-to-pay, vendor-accreditation |
| feature-procurement-approvals | live | 5 | /procurement/approvals | Procurement | procure-to-pay, doa-governance, vendor-accreditation |
| feature-procurement-purchase-orders | live | 3 | /procurement/purchase-orders | Procurement | procure-to-pay, vendor-accreditation, receive-to-putaway |
| feature-procurement-po-detail | live | 8 | /procurement/purchase-orders/:id | Procurement | procure-to-pay, vendor-accreditation, receive-to-putaway |
| feature-legal-cases | live | 4 | /legal | Legal | vendor-accreditation |
| feature-legal-case-detail | live | 7 | /legal/cases/:id | Legal | vendor-accreditation |
| feature-legal-case-application | live | 2 | /legal/cases/:id/application | Legal | vendor-accreditation |
| feature-legal-sign-instrument | live | 2 | /legal/cases/:id/sign/:code | Legal | vendor-accreditation |
| feature-legal-invite-vendor | live | 3 | /legal/invites/new | Legal | vendor-accreditation |
| feature-vendor-cases | live | 2 | /vendor | Legal | vendor-accreditation, vendor-application-submission |
| feature-vendor-purchase-orders | live | 2 | /vendor/purchase-orders | Legal | procure-to-pay |
| feature-vendor-case-detail | live | 6 | /vendor/cases/:id | Legal | vendor-accreditation, vendor-application-submission |
| feature-vendor-application | live | 6 | /vendor/cases/:id/application | Legal | vendor-accreditation, vendor-application-submission |
| feature-vendor-sign-instrument | live | 3 | /vendor/cases/:id/sign/:code | Legal | vendor-accreditation |
| feature-vendor-invite-unavailable | live | 2 | /vendor/invites/new | Legal | vendor-accreditation, identity-and-access |
| feature-cms | coming_soon | 1 | No executable route | Platform | Reference only |
| feature-analytics | coming_soon | 1 | No executable route | Platform | Reference only |
| feature-feedback | coming_soon | 1 | No executable route | Platform | Reference only |
| feature-traceability | coming_soon | 1 | No executable route | Platform | Reference only |
| feature-walkthrough | coming_soon | 1 | No executable route | Platform | Reference only |
| feature-language | coming_soon | 1 | No executable route | Platform | Reference only |
| feature-offline | coming_soon | 1 | No executable route | Platform | exception-and-recovery |
| feature-learning | coming_soon | 1 | No executable route | Platform | Reference only |
| feature-release | coming_soon | 1 | No executable route | Platform | Reference only |

## Controlled References

- Identity and access policy requires active attributable identities and least-privilege scoped access.
- Knowledge governance requires owned, reviewed, current guidance that does not grant operational authority.
- Vendor accreditation policy requires scoped requirements, sufficient evidence, residual-risk review, required instruments, and authorized disposition.
- Vendor portal policy restricts every read and write to the authenticated vendor's own case and applicable requirements.
- Operational resilience requires clear saved-state, connectivity, retry, and escalation behavior.
- Warehouse custody policy requires attributable reservation, issue, transfer, consumption, return, and event reconciliation.
- Warehouse control policy requires attributable stock movement, valid source records, traceability, evidence, and controlled destinations.
- Inventory integrity policy requires physical and ledger reconciliation before an approved stock adjustment.
- Procurement policy requires threshold- and risk-appropriate sourcing, competition evidence, vendor eligibility, budget evidence, and active approval authority.
- Product governance requires complete readiness evidence, an independent Product go-live decision, an attributable Operations handoff, and independently approved effective-dated pricing.
- Pricing and valuation policy requires supported cost basis, effective dating, independent review, and immutable price history.
- Delegation of Authority governance requires effective-dated, complete, non-conflicting approval coverage.
- Warehouse quality policy requires documented inspection and authorized hold, release, return, or rejection disposition.
- Payment-readiness policy requires approved demand, eligible supplier, receipt, inspection, requester acceptance, invoice, and amount reconciliation.

## Machine-readable Control Snapshot

This is inventory metadata, not a screenshot acceptance manifest. Each exact key is featureId:controlName.

```json
{
  "counts": {
    "features": 68,
    "controls": 294,
    "liveFeatures": 59,
    "limitedFeatures": 0,
    "comingSoonFeatures": 9,
    "flows": 26,
    "decisions": 58,
    "policyReferences": 14,
    "evidenceRecords": 53,
    "controlEvidenceMatches": 0
  },
  "controls": [
    {
      "key": "shell-home:Open module",
      "referenceId": "feature-shell-home",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "shell-home:Open notification",
      "referenceId": "feature-shell-home",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "shell-home:Use primary navigation",
      "referenceId": "feature-shell-home",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "shell-home:Hide navigation / Show navigation",
      "referenceId": "feature-shell-home",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "shell-home:View account details",
      "referenceId": "feature-shell-home",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "sign-in:Sign in",
      "referenceId": "feature-sign-in",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "sign-in:Send reset link",
      "referenceId": "feature-sign-in",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "sign-in:Use demo profile",
      "referenceId": "feature-sign-in",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "reset-password:Update password",
      "referenceId": "feature-reset-password",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "reset-password:Back to sign in",
      "referenceId": "feature-reset-password",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "knowledge-library:Search handbook",
      "referenceId": "feature-knowledge-library",
      "availability": "live",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "knowledge-library:Filter role",
      "referenceId": "feature-knowledge-library",
      "availability": "live",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "knowledge-library:Filter module",
      "referenceId": "feature-knowledge-library",
      "availability": "live",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "knowledge-library:Filter content type",
      "referenceId": "feature-knowledge-library",
      "availability": "live",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "knowledge-library:Open contextual guidance",
      "referenceId": "feature-knowledge-library",
      "availability": "live",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "role-onboarding:Change task / All eligible tasks",
      "referenceId": "feature-role-onboarding",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "role-onboarding:Start or resume requirement",
      "referenceId": "feature-role-onboarding",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "role-onboarding:Refresh status",
      "referenceId": "feature-role-onboarding",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "role-onboarding:Open support guidance",
      "referenceId": "feature-role-onboarding",
      "availability": "live",
      "flowIds": [
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-onboarding:Start or resume vendor requirement",
      "referenceId": "feature-vendor-onboarding",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-onboarding:Return to vendor portal",
      "referenceId": "feature-vendor-onboarding",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-onboarding:Sign out",
      "referenceId": "feature-vendor-onboarding",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "offline-status:Reconnect application",
      "referenceId": "feature-offline-status",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "offline-status:Verify queued work",
      "referenceId": "feature-offline-status",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "my-work:Needs your action / Waiting on someone else / Recently completed",
      "referenceId": "feature-my-work",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "my-work:How work is assigned",
      "referenceId": "feature-my-work",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "my-work:Module",
      "referenceId": "feature-my-work",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "my-work:Open record",
      "referenceId": "feature-my-work",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "my-work:Search work",
      "referenceId": "feature-my-work",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "my-work:Retry",
      "referenceId": "feature-my-work",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "events-workspace:New event",
      "referenceId": "feature-events-workspace",
      "availability": "live",
      "flowIds": [
        "event-intent-and-fulfillment",
        "event-fulfillment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "events-workspace:Create event",
      "referenceId": "feature-events-workspace",
      "availability": "live",
      "flowIds": [
        "event-intent-and-fulfillment",
        "event-fulfillment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "events-workspace:View event",
      "referenceId": "feature-events-workspace",
      "availability": "live",
      "flowIds": [
        "event-intent-and-fulfillment",
        "event-fulfillment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "events-workspace:Open Warehouse fulfillment",
      "referenceId": "feature-events-workspace",
      "availability": "live",
      "flowIds": [
        "event-intent-and-fulfillment",
        "event-fulfillment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "insights-workspace:Insight view",
      "referenceId": "feature-insights-workspace",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "insights-workspace:Open governed source",
      "referenceId": "feature-insights-workspace",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "insights-workspace:Export governed snapshot",
      "referenceId": "feature-insights-workspace",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "insights-workspace:Request validation or escalation",
      "referenceId": "feature-insights-workspace",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "insights-workspace:Track follow-ups in My Work",
      "referenceId": "feature-insights-workspace",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "insights-workspace:Acknowledge",
      "referenceId": "feature-insights-workspace",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "insights-workspace:Resolve",
      "referenceId": "feature-insights-workspace",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "insights-workspace:Retry",
      "referenceId": "feature-insights-workspace",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "product-governance:Submit readiness package",
      "referenceId": "feature-product-governance",
      "availability": "live",
      "flowIds": [
        "product-launch-governance",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "product-governance:Decide go-live",
      "referenceId": "feature-product-governance",
      "availability": "live",
      "flowIds": [
        "product-launch-governance",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "product-governance:Acknowledge Operations handoff",
      "referenceId": "feature-product-governance",
      "availability": "live",
      "flowIds": [
        "product-launch-governance",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "product-governance:Submit pricing proposal",
      "referenceId": "feature-product-governance",
      "availability": "live",
      "flowIds": [
        "product-launch-governance",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "product-governance:Decide pricing proposal",
      "referenceId": "feature-product-governance",
      "availability": "live",
      "flowIds": [
        "product-launch-governance",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-governance:Open users",
      "referenceId": "feature-admin-governance",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "doa-governance",
        "access-recertification-offboarding",
        "audit-incident-handling"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-governance:Open authority",
      "referenceId": "feature-admin-governance",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "doa-governance",
        "access-recertification-offboarding",
        "audit-incident-handling"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-governance:Open runbook",
      "referenceId": "feature-admin-governance",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "doa-governance",
        "access-recertification-offboarding",
        "audit-incident-handling"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-users:Open profile",
      "referenceId": "feature-admin-users",
      "availability": "live",
      "flowIds": [
        "identity-and-access",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-users:Assign role",
      "referenceId": "feature-admin-users",
      "availability": "live",
      "flowIds": [
        "identity-and-access",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-users:Revoke role",
      "referenceId": "feature-admin-users",
      "availability": "live",
      "flowIds": [
        "identity-and-access",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-audit:Search audit history / Search",
      "referenceId": "feature-admin-audit",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "audit-incident-handling"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-audit:From (UTC+08) / Through (UTC+08)",
      "referenceId": "feature-admin-audit",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "audit-incident-handling"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-audit:Filter module",
      "referenceId": "feature-admin-audit",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "audit-incident-handling"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-audit:Continue searching / Older results / Previous",
      "referenceId": "feature-admin-audit",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "audit-incident-handling"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-audit:Export current page CSV",
      "referenceId": "feature-admin-audit",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "audit-incident-handling"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-audit:Retry audit history",
      "referenceId": "feature-admin-audit",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "audit-incident-handling"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-audit:Open technical details",
      "referenceId": "feature-admin-audit",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "audit-incident-handling"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-departments:Add department",
      "referenceId": "feature-admin-departments",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "doa-governance"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-departments:Edit department",
      "referenceId": "feature-admin-departments",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "doa-governance"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-departments:Choose parent",
      "referenceId": "feature-admin-departments",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "doa-governance"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-departments:Save department",
      "referenceId": "feature-admin-departments",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "doa-governance"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-departments:Deactivate department",
      "referenceId": "feature-admin-departments",
      "availability": "live",
      "flowIds": [
        "administration",
        "identity-and-access",
        "doa-governance"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-doa:Create revision",
      "referenceId": "feature-admin-doa",
      "availability": "live",
      "flowIds": [
        "doa-governance",
        "administration",
        "procure-to-pay"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-doa:Activate matrix",
      "referenceId": "feature-admin-doa",
      "availability": "live",
      "flowIds": [
        "doa-governance",
        "administration",
        "procure-to-pay"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-doa:Add tier",
      "referenceId": "feature-admin-doa",
      "availability": "live",
      "flowIds": [
        "doa-governance",
        "administration",
        "procure-to-pay"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-doa:Remove tier",
      "referenceId": "feature-admin-doa",
      "availability": "live",
      "flowIds": [
        "doa-governance",
        "administration",
        "procure-to-pay"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "admin-doa:Save draft",
      "referenceId": "feature-admin-doa",
      "availability": "live",
      "flowIds": [
        "doa-governance",
        "administration",
        "procure-to-pay"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-dashboard:Open primary task",
      "referenceId": "feature-warehouse-dashboard",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-dashboard:Open product alert",
      "referenceId": "feature-warehouse-dashboard",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-dashboard:Open event",
      "referenceId": "feature-warehouse-dashboard",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-dashboard:Open export menu",
      "referenceId": "feature-warehouse-dashboard",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-dashboard:Export inventory",
      "referenceId": "feature-warehouse-dashboard",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-dashboard:Export movements",
      "referenceId": "feature-warehouse-dashboard",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-scan:Start scanner",
      "referenceId": "feature-warehouse-scan",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-scan:Enter code manually",
      "referenceId": "feature-warehouse-scan",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-scan:Choose operation",
      "referenceId": "feature-warehouse-scan",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-tasks:Show due tasks",
      "referenceId": "feature-warehouse-tasks",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-tasks:Show blocked tasks",
      "referenceId": "feature-warehouse-tasks",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-tasks:Open task",
      "referenceId": "feature-warehouse-tasks",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-inventory:Search inventory",
      "referenceId": "feature-warehouse-inventory",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-inventory:Filter stock state",
      "referenceId": "feature-warehouse-inventory",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-inventory:Open product",
      "referenceId": "feature-warehouse-inventory",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-inventory:Create product",
      "referenceId": "feature-warehouse-inventory",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-inventory:Edit product",
      "referenceId": "feature-warehouse-inventory",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "event-fulfillment",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-product-detail:Back to inventory",
      "referenceId": "feature-warehouse-product-detail",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-product-detail:Edit product",
      "referenceId": "feature-warehouse-product-detail",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-product-detail:Transfer stock",
      "referenceId": "feature-warehouse-product-detail",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-product-detail:Relocate stock",
      "referenceId": "feature-warehouse-product-detail",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-product-detail:Adjust count",
      "referenceId": "feature-warehouse-product-detail",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-product-detail:Set price",
      "referenceId": "feature-warehouse-product-detail",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-product-detail:Open traceability",
      "referenceId": "feature-warehouse-product-detail",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-product-detail:Open financial context",
      "referenceId": "feature-warehouse-product-detail",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-receiving:Select purchase order",
      "referenceId": "feature-warehouse-receiving",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-receiving:Add receipt line",
      "referenceId": "feature-warehouse-receiving",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-receiving:Capture evidence",
      "referenceId": "feature-warehouse-receiving",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-receiving:Submit receipt",
      "referenceId": "feature-warehouse-receiving",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-receiving:Reset draft",
      "referenceId": "feature-warehouse-receiving",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "quality-disposition"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-allocations:Create reservation",
      "referenceId": "feature-warehouse-allocations",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-allocations:Cancel reservation",
      "referenceId": "feature-warehouse-allocations",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-allocations:Open issue",
      "referenceId": "feature-warehouse-allocations",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-allocations:Confirm issue",
      "referenceId": "feature-warehouse-allocations",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-allocations:Open return",
      "referenceId": "feature-warehouse-allocations",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Queue filters",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:View order details",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Create order or demand",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Import existing tracker",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Export current view",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Print barcode sheet",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Submit department request",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Decide request",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Allocate stock",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Confirm pick",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Confirm pack",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Release order",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Acknowledge receipt",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Update delivery with proof",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Split backorder or cancel",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Create return or re-kit work",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-fulfillment:Complete re-kit",
      "referenceId": "feature-warehouse-fulfillment",
      "availability": "live",
      "flowIds": [
        "outbound-fulfillment",
        "event-fulfillment",
        "receive-to-putaway",
        "returns-reconciliation",
        "procure-to-pay",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-returns:Select return source",
      "referenceId": "feature-warehouse-returns",
      "availability": "live",
      "flowIds": [
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-returns:Set disposition",
      "referenceId": "feature-warehouse-returns",
      "availability": "live",
      "flowIds": [
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-returns:Capture return evidence",
      "referenceId": "feature-warehouse-returns",
      "availability": "live",
      "flowIds": [
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-returns:Submit return",
      "referenceId": "feature-warehouse-returns",
      "availability": "live",
      "flowIds": [
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-storage:Create area",
      "referenceId": "feature-warehouse-storage",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-storage:Add bin",
      "referenceId": "feature-warehouse-storage",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-storage:Edit storage",
      "referenceId": "feature-warehouse-storage",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-storage:Put away stock",
      "referenceId": "feature-warehouse-storage",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-storage:Transfer bin stock",
      "referenceId": "feature-warehouse-storage",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-events:Create event",
      "referenceId": "feature-warehouse-events",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-events:Filter events",
      "referenceId": "feature-warehouse-events",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-events:Open event",
      "referenceId": "feature-warehouse-events",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-events:Save event",
      "referenceId": "feature-warehouse-events",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-event-detail:Back to events",
      "referenceId": "feature-warehouse-event-detail",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-event-detail:Reserve stock",
      "referenceId": "feature-warehouse-event-detail",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-event-detail:Issue reservation",
      "referenceId": "feature-warehouse-event-detail",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-event-detail:Confirm issue",
      "referenceId": "feature-warehouse-event-detail",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-event-detail:Cancel reservation",
      "referenceId": "feature-warehouse-event-detail",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-event-detail:Record return",
      "referenceId": "feature-warehouse-event-detail",
      "availability": "live",
      "flowIds": [
        "event-fulfillment",
        "returns-reconciliation",
        "allocation-event-return"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-procurement-planning:Filter stock risk",
      "referenceId": "feature-warehouse-procurement-planning",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-procurement-planning:Open product plan",
      "referenceId": "feature-warehouse-procurement-planning",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-procurement-planning:Save recommendation",
      "referenceId": "feature-warehouse-procurement-planning",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-procurement-planning:Hand to Procurement",
      "referenceId": "feature-warehouse-procurement-planning",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-procurement-planning:Review inbound supply",
      "referenceId": "feature-warehouse-procurement-planning",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-procurement-planning:Export planning view",
      "referenceId": "feature-warehouse-procurement-planning",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-purchase-orders:Filter orders",
      "referenceId": "feature-warehouse-purchase-orders",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-purchase-orders:Open order",
      "referenceId": "feature-warehouse-purchase-orders",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-purchase-orders:Create order",
      "referenceId": "feature-warehouse-purchase-orders",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-purchase-orders:Cancel order",
      "referenceId": "feature-warehouse-purchase-orders",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-purchase-orders:Receive order",
      "referenceId": "feature-warehouse-purchase-orders",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-cycle-counts:Select count scope",
      "referenceId": "feature-warehouse-cycle-counts",
      "availability": "live",
      "flowIds": [
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-cycle-counts:Toggle blind count",
      "referenceId": "feature-warehouse-cycle-counts",
      "availability": "live",
      "flowIds": [
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-cycle-counts:Show variances only",
      "referenceId": "feature-warehouse-cycle-counts",
      "availability": "live",
      "flowIds": [
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-cycle-counts:Confirm uncounted lines",
      "referenceId": "feature-warehouse-cycle-counts",
      "availability": "live",
      "flowIds": [
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-cycle-counts:Submit count",
      "referenceId": "feature-warehouse-cycle-counts",
      "availability": "live",
      "flowIds": [
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-quality:Retry quality queue",
      "referenceId": "feature-warehouse-quality",
      "availability": "live",
      "flowIds": [
        "quality-disposition",
        "receive-to-putaway",
        "returns-reconciliation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-quality:Open inspection",
      "referenceId": "feature-warehouse-quality",
      "availability": "live",
      "flowIds": [
        "quality-disposition",
        "receive-to-putaway",
        "returns-reconciliation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-quality:Attach inspection evidence",
      "referenceId": "feature-warehouse-quality",
      "availability": "live",
      "flowIds": [
        "quality-disposition",
        "receive-to-putaway",
        "returns-reconciliation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-quality:Accept stock",
      "referenceId": "feature-warehouse-quality",
      "availability": "live",
      "flowIds": [
        "quality-disposition",
        "receive-to-putaway",
        "returns-reconciliation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-quality:Place hold",
      "referenceId": "feature-warehouse-quality",
      "availability": "live",
      "flowIds": [
        "quality-disposition",
        "receive-to-putaway",
        "returns-reconciliation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-quality:Release hold",
      "referenceId": "feature-warehouse-quality",
      "availability": "live",
      "flowIds": [
        "quality-disposition",
        "receive-to-putaway",
        "returns-reconciliation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-quality:Reject stock",
      "referenceId": "feature-warehouse-quality",
      "availability": "live",
      "flowIds": [
        "quality-disposition",
        "receive-to-putaway",
        "returns-reconciliation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-approvals:Open approval",
      "referenceId": "feature-warehouse-approvals",
      "availability": "live",
      "flowIds": [
        "cycle-count-adjustment",
        "quality-disposition",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-approvals:Approve change",
      "referenceId": "feature-warehouse-approvals",
      "availability": "live",
      "flowIds": [
        "cycle-count-adjustment",
        "quality-disposition",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-approvals:Reject change",
      "referenceId": "feature-warehouse-approvals",
      "availability": "live",
      "flowIds": [
        "cycle-count-adjustment",
        "quality-disposition",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-approvals:Close decision",
      "referenceId": "feature-warehouse-approvals",
      "availability": "live",
      "flowIds": [
        "cycle-count-adjustment",
        "quality-disposition",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-exceptions:Filter exceptions",
      "referenceId": "feature-warehouse-exceptions",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery",
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-exceptions:Clear filters",
      "referenceId": "feature-warehouse-exceptions",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery",
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-exceptions:Open exception",
      "referenceId": "feature-warehouse-exceptions",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery",
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-exceptions:Resolve exception",
      "referenceId": "feature-warehouse-exceptions",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery",
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-exceptions:Reopen exception",
      "referenceId": "feature-warehouse-exceptions",
      "availability": "live",
      "flowIds": [
        "exception-and-recovery",
        "receive-to-putaway",
        "quality-disposition",
        "returns-reconciliation",
        "cycle-count-adjustment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-finance:Prepare close entry",
      "referenceId": "feature-warehouse-finance",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-finance:Open evidence",
      "referenceId": "feature-warehouse-finance",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-finance:Flag",
      "referenceId": "feature-warehouse-finance",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-finance:Edit and resubmit",
      "referenceId": "feature-warehouse-finance",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-finance:Post",
      "referenceId": "feature-warehouse-finance",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-finance:Reconcile",
      "referenceId": "feature-warehouse-finance",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-finance:Review next payment pack",
      "referenceId": "feature-warehouse-finance",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-finance:Filter cross-module activity",
      "referenceId": "feature-warehouse-finance",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-finance:Open source record",
      "referenceId": "feature-warehouse-finance",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-finance:Retry unavailable sources",
      "referenceId": "feature-warehouse-finance",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-pricing:Filter products",
      "referenceId": "feature-warehouse-pricing",
      "availability": "live",
      "flowIds": [
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-pricing:Open price editor",
      "referenceId": "feature-warehouse-pricing",
      "availability": "live",
      "flowIds": [
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-pricing:Save price",
      "referenceId": "feature-warehouse-pricing",
      "availability": "live",
      "flowIds": [
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-pricing:Cancel edit",
      "referenceId": "feature-warehouse-pricing",
      "availability": "live",
      "flowIds": [
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-data:Export inventory",
      "referenceId": "feature-warehouse-data",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-data:Export movements",
      "referenceId": "feature-warehouse-data",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-data:Export allocations",
      "referenceId": "feature-warehouse-data",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-data:Export inventory position",
      "referenceId": "feature-warehouse-data",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-data:Export quality",
      "referenceId": "feature-warehouse-data",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-data:Export cycle counts",
      "referenceId": "feature-warehouse-data",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-reports:Select report",
      "referenceId": "feature-warehouse-reports",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-reports:Apply report filters",
      "referenceId": "feature-warehouse-reports",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-reports:Generate report",
      "referenceId": "feature-warehouse-reports",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-reports:Export CSV",
      "referenceId": "feature-warehouse-reports",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-reports:Clear report",
      "referenceId": "feature-warehouse-reports",
      "availability": "live",
      "flowIds": [
        "receive-to-putaway",
        "event-fulfillment",
        "exception-and-recovery",
        "returns-reconciliation",
        "cycle-count-adjustment",
        "pricing-and-costing"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-suppliers:Search suppliers",
      "referenceId": "feature-warehouse-suppliers",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "warehouse-setup",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-suppliers:Filter accreditation",
      "referenceId": "feature-warehouse-suppliers",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "warehouse-setup",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-suppliers:Open supplier",
      "referenceId": "feature-warehouse-suppliers",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "warehouse-setup",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-suppliers:Save planning values",
      "referenceId": "feature-warehouse-suppliers",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "warehouse-setup",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-locations:Create location",
      "referenceId": "feature-warehouse-locations",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway",
        "event-fulfillment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-locations:Edit location",
      "referenceId": "feature-warehouse-locations",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway",
        "event-fulfillment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-locations:Save location",
      "referenceId": "feature-warehouse-locations",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway",
        "event-fulfillment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-locations:Deactivate location",
      "referenceId": "feature-warehouse-locations",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "receive-to-putaway",
        "event-fulfillment"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-imports:Choose file",
      "referenceId": "feature-warehouse-imports",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-imports:Validate import",
      "referenceId": "feature-warehouse-imports",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-imports:Preview rows",
      "referenceId": "feature-warehouse-imports",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-imports:Commit import",
      "referenceId": "feature-warehouse-imports",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-imports:Download errors",
      "referenceId": "feature-warehouse-imports",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-operation-routes:Create route",
      "referenceId": "feature-warehouse-operation-routes",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-operation-routes:Edit route",
      "referenceId": "feature-warehouse-operation-routes",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-operation-routes:Save route",
      "referenceId": "feature-warehouse-operation-routes",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-operation-routes:Toggle route",
      "referenceId": "feature-warehouse-operation-routes",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "warehouse-operation-routes:Delete draft route",
      "referenceId": "feature-warehouse-operation-routes",
      "availability": "live",
      "flowIds": [
        "warehouse-setup",
        "administration"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-requests:Create request",
      "referenceId": "feature-procurement-requests",
      "availability": "live",
      "flowIds": [
        "procure-to-pay"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-requests:Filter status",
      "referenceId": "feature-procurement-requests",
      "availability": "live",
      "flowIds": [
        "procure-to-pay"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-requests:Open request",
      "referenceId": "feature-procurement-requests",
      "availability": "live",
      "flowIds": [
        "procure-to-pay"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-create:Next step",
      "referenceId": "feature-procurement-request-create",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-create:Previous step",
      "referenceId": "feature-procurement-request-create",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-create:Add line",
      "referenceId": "feature-procurement-request-create",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-create:Save draft",
      "referenceId": "feature-procurement-request-create",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-create:Submit request",
      "referenceId": "feature-procurement-request-create",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-detail:Edit draft / revise rejected request",
      "referenceId": "feature-procurement-request-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-detail:Confirm sourcing route",
      "referenceId": "feature-procurement-request-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-detail:Submit for approval",
      "referenceId": "feature-procurement-request-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-detail:Cancel request",
      "referenceId": "feature-procurement-request-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-detail:Author purchase order",
      "referenceId": "feature-procurement-request-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-request-detail:Open attachment",
      "referenceId": "feature-procurement-request-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-approvals:Back to requests",
      "referenceId": "feature-procurement-approvals",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "doa-governance",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-approvals:Open decision",
      "referenceId": "feature-procurement-approvals",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "doa-governance",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-approvals:Approve request",
      "referenceId": "feature-procurement-approvals",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "doa-governance",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-approvals:Reject request",
      "referenceId": "feature-procurement-approvals",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "doa-governance",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-approvals:Close decision",
      "referenceId": "feature-procurement-approvals",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "doa-governance",
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-purchase-orders:Author purchase order",
      "referenceId": "feature-procurement-purchase-orders",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-purchase-orders:Filter orders",
      "referenceId": "feature-procurement-purchase-orders",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-purchase-orders:Open purchase order",
      "referenceId": "feature-procurement-purchase-orders",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-po-detail:Add policy evidence",
      "referenceId": "feature-procurement-po-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-po-detail:Approve award",
      "referenceId": "feature-procurement-po-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-po-detail:Issue order",
      "referenceId": "feature-procurement-po-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-po-detail:Cancel order",
      "referenceId": "feature-procurement-po-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-po-detail:Record acceptance",
      "referenceId": "feature-procurement-po-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-po-detail:Prepare payment",
      "referenceId": "feature-procurement-po-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-po-detail:Correct payment evidence",
      "referenceId": "feature-procurement-po-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "procurement-po-detail:Review payment",
      "referenceId": "feature-procurement-po-detail",
      "availability": "live",
      "flowIds": [
        "procure-to-pay",
        "vendor-accreditation",
        "receive-to-putaway"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-cases:Accreditation cases / Vendor lifecycle",
      "referenceId": "feature-legal-cases",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-cases:Filter case status",
      "referenceId": "feature-legal-cases",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-cases:Clear case filter",
      "referenceId": "feature-legal-cases",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-cases:Open case",
      "referenceId": "feature-legal-cases",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-case-detail:Open application",
      "referenceId": "feature-legal-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-case-detail:Open checklist item",
      "referenceId": "feature-legal-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-case-detail:Approve evidence",
      "referenceId": "feature-legal-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-case-detail:Request correction",
      "referenceId": "feature-legal-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-case-detail:Record manual reminder",
      "referenceId": "feature-legal-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-case-detail:Approve case",
      "referenceId": "feature-legal-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-case-detail:Reject case",
      "referenceId": "feature-legal-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-case-application:Back to case",
      "referenceId": "feature-legal-case-application",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-case-application:Review section",
      "referenceId": "feature-legal-case-application",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-sign-instrument:Back to legal case",
      "referenceId": "feature-legal-sign-instrument",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-sign-instrument:Review signed record",
      "referenceId": "feature-legal-sign-instrument",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-invite-vendor:Send invitation",
      "referenceId": "feature-legal-invite-vendor",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-invite-vendor:Reset invitation form",
      "referenceId": "feature-legal-invite-vendor",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "legal-invite-vendor:Back to cases",
      "referenceId": "feature-legal-invite-vendor",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-cases:Open own case",
      "referenceId": "feature-vendor-cases",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-cases:Sign out vendor",
      "referenceId": "feature-vendor-cases",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-purchase-orders:Purchase orders / Back to vendor portal",
      "referenceId": "feature-vendor-purchase-orders",
      "availability": "live",
      "flowIds": [
        "procure-to-pay"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-purchase-orders:Acknowledge purchase order",
      "referenceId": "feature-vendor-purchase-orders",
      "availability": "live",
      "flowIds": [
        "procure-to-pay"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-case-detail:Open application",
      "referenceId": "feature-vendor-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-case-detail:Upload evidence",
      "referenceId": "feature-vendor-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-case-detail:Complete requirements",
      "referenceId": "feature-vendor-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-case-detail:Submit for review",
      "referenceId": "feature-vendor-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-case-detail:Open instrument",
      "referenceId": "feature-vendor-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-case-detail:Replace evidence",
      "referenceId": "feature-vendor-case-detail",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-application:Save section",
      "referenceId": "feature-vendor-application",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-application:Discard draft",
      "referenceId": "feature-vendor-application",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-application:Previous section",
      "referenceId": "feature-vendor-application",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-application:Next section",
      "referenceId": "feature-vendor-application",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-application:Submit application",
      "referenceId": "feature-vendor-application",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-application:Back to case",
      "referenceId": "feature-vendor-application",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "vendor-application-submission"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-sign-instrument:Cancel signature",
      "referenceId": "feature-vendor-sign-instrument",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-sign-instrument:Enter signature",
      "referenceId": "feature-vendor-sign-instrument",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-sign-instrument:Confirm signature",
      "referenceId": "feature-vendor-sign-instrument",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-invite-unavailable:Return to own case",
      "referenceId": "feature-vendor-invite-unavailable",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "vendor-invite-unavailable:Sign out vendor",
      "referenceId": "feature-vendor-invite-unavailable",
      "availability": "live",
      "flowIds": [
        "vendor-accreditation",
        "identity-and-access"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "cms:Draft and publish governed article revisions",
      "referenceId": "feature-cms",
      "availability": "coming_soon",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "analytics:Review privacy-safe search gap metrics",
      "referenceId": "feature-analytics",
      "availability": "coming_soon",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "feedback:Submit an attributable correction request",
      "referenceId": "feature-feedback",
      "availability": "coming_soon",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "traceability:Link a governed policy clause to a control",
      "referenceId": "feature-traceability",
      "availability": "coming_soon",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "walkthrough:Start a disposable guided practice session",
      "referenceId": "feature-walkthrough",
      "availability": "coming_soon",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "language:Review and publish a version-matched translation",
      "referenceId": "feature-language",
      "availability": "coming_soon",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "offline:Make approved guidance available offline",
      "referenceId": "feature-offline",
      "availability": "coming_soon",
      "flowIds": [
        "exception-and-recovery"
      ],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "learning:Assign a governed role curriculum",
      "referenceId": "feature-learning",
      "availability": "coming_soon",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    },
    {
      "key": "release:Open release guidance for a changed workflow",
      "referenceId": "feature-release",
      "availability": "coming_soon",
      "flowIds": [],
      "evidenceIds": [],
      "unverified": true
    }
  ]
}
```

## Verification and Remaining Work

Historical local verification (before the September 11 UX inventory update): coverage, FeatureGuide, taskGuidance and guideComponents tests passed 64/64 across four files. The updated section assertions retained explicit error-recovery and completion-evidence content checks. Scoped lint and the subsequent shell-wide typecheck passed. The initial typecheck found an unrelated unknown-to-string error at app/api/knowledge/experience/route.ts:28, resolved by its owner; no unrelated source edit was made. API tests are outside the default knowledge-test discovery and remain with integration.

Historical handbook verification: the standalone handbook was regenerated from 36 source documents using the existing documentation command; freshness validation and documentation tests (85/85) passed. These are earlier local checks, not verification of the current September 11 candidate, deployment or human-pilot acceptance. Current documentation checks are recorded in the September 11 UX candidate release note.

Evidence/QA owner: post-freeze accepted control/state desktop+mobile captures and rendered review. Process owners: confirm current fields, prerequisites, next owners, governed policy versions and explicit bounded recovery. Integration: connect stable task catalog coverage without replacing exact reference mappings. Pilot owner: execute docs/training/task-first-pilot-protocol.md; no participant results yet.
