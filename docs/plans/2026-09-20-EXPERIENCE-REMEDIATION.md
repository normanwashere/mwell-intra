# September 20 app experience remediation

Status: local implementation and checks complete; UAT deployment, native concurrency and live certification remain open.

Scope: UX-01 through UX-15 from the September 20 live role/journey audit at commit 2c2adfb6b4004a505369f3286dea044d32199517. Audit evidence is in the sibling mwell-intra-warehouse/outputs/app-experience-audit-20260920 directory.

## Decisions

- Each event seller records their own sales and giveaways using an individually identified, event-limited account. Do not grant sellers broad Warehouse permissions.
- Returned event watches convert to base watches through a Product-approved recovery recipe after required return inspection. Do not relabel stock or delete variant history.
- Quantities and packaging are explicit inputs; do not hard-code 50 or 100 watches, and balance bags separately.
- SMTP and the external reporting API remain outside this remediation.
- Preserve approval, independence, learning, evidence, serial and stock-custody controls.

## Delivery checklist

- [x] Local UX-01 / UX-13 / UX-14: scoped open-work continuation, search and explicit scenario/load-fixture views.
- [x] Local UX-07 / UX-15: consistent workspace switching and permission-aware cross-module links.
- [x] Local UX-05 / UX-06 / UX-08 / UX-09: dense desktop queue, mobile references, grouped actionable alerts, consistent status and contextual returns.
- [x] Local UX-10 / UX-11 / UX-12: returning-user Home, simpler KB and completed onboarding.
- [x] Local UX-02: one multi-line event demand with the existing approval handoff.
- [x] Local UX-04: atomic bounded batch inspection with individual results, owned evidence and typed retry recovery.
- [x] Local UX-03: approved stock-origin conversion, event-assigned sellers, custody outcomes and recipe-based recovery. Retirement/correction policy remains open.
- [x] Focused negative/regression tests; local desktop/mobile walkthroughs; source and independent review.
- [x] Candidate documentation and evidence updated with no unproven live claims.
- [ ] Native concurrency, installed migration-chain verification, UAT rollout and complete saved multi-user journey.

## Implemented Candidate Boundaries

UX-03 now has the seller ledger, Product-owned recipe approval, independent conversion review and recovery code. Independent review added retained receipt-serial trigger compatibility, operator/Product route access, cancellation/settlement guards and date-window checks. SKU retirement and post-event correction windows remain business-policy questions, not silently granted capabilities. The default remains a reusable variant with retained history and strict seller dates.

The final production build and ten affected package typechecks passed. Package suites report 3,729 passes with one existing opt-in browser test skipped; isolated SQL tests report 102 passes. The final production-preview crawl captured 44 views with no detected overflow, page errors or automated accessibility findings. A further 45 fulfillment and simulated Product/Events views are labelled separately. Exact results and limitations are recorded in the remediation ledger. Local SQL tests use PGlite with retained production functions where documented; they are not native multi-connection or live UAT certification.

## Release gates

No migration or deployment is implied by local completion. Verify database contracts, bounded concurrency/idempotency, role isolation and saved stock/evidence results before a live release. Preserve existing tester data. Record any remaining limits explicitly.
