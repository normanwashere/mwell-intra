# Knowledge Base Release Coverage Report

Reviewed: 2026-07-13

Branch: `codex/knowledge-base-semantic-remediation`

Current base commit: `c6cf333328d22414167e4362313ad45d91adaffd`

Reviewer verdict: **CODE READY FOR REVIEW; PRODUCTION EVIDENCE RECAPTURE REQUIRED AFTER DEPLOYMENT**

Current evidence source commit: `d021d170bff5f8179ef95159a2bdcda7449840ea`

## Release verdict

The implemented Knowledge Base is structurally complete for the current Mwell Intra feature set and passes its content, graph, navigation, responsive, accessibility, and interaction contracts. Search is the primary entry point, workflows are grouped into operating phases, mobile flows open at their first decision, role and feature guidance use plain language, policy references expose document-control status, and implemented application pages link to their exact guide.

This report does **not** label the current screenshot set as release-current. The registered production evidence predates this remediation branch. After the code is deployed, the documentation capture must be regenerated against the exact deployed commit, reviewed for privacy and hotspot accuracy, committed, and deployed again before the evidence can be promoted from historical reference to current release evidence.

## Contract coverage

| Contract | Coverage | Result |
| --- | ---: | --- |
| Roles | 20 live + 6 coming soon = 26 | Complete |
| Features | 49 live + 9 coming soon = 58 | Complete |
| Live route patterns | 49 | Every implemented route has one live feature guide |
| Knowledge articles | 115 | Owners and review dates present |
| Principal workflows | 14 live + 9 limited = 23 | All graph nodes reachable and terminating |
| Decision nodes | 47 | Authority and policy fields present |
| Terminal nodes | 64 | 24 complete, 21 escalated, 11 revision, 6 rejected, 2 cancelled |
| Evidence requirements | 39 desktop/mobile pairs = 78 screenshots | Catalog valid; recapture required for the new deployed commit |
| Responsive sizes | 1440x900, 1280x800, 768x1024, 390x844, 360x800, 320x720 | Exercised |

`buildKnowledgeCoverage` and the Knowledge Base validator report zero unexplained route, role, feature, policy, graph, or evidence-catalog gaps.

## Implemented experience

- Search appears before workflow browsing and indexes titles, aliases, controls, fields, statuses, policy terms, screenshot instructions, and operational routes.
- Search requires meaningful multi-token matches and ranks live guidance above roadmap material unless the user explicitly requests future features.
- The complete workflow catalogue is grouped into Govern and secure, Source and control, Operate inventory, and Recover and improve phases.
- Phase disclosures mount only the active workflow controls, preventing hidden or intercepted targets.
- Desktop workflow diagrams use centered depth layers, readable branch labels, distinct decision styling, and direct node selection.
- Mobile workflow guidance starts at the first actionable decision, preserves URL branch history, supports backtracking, and limits viewport movement to one 16px spacing unit.
- Role guides list accessible pages, named capabilities, granted/denied status, decision authority, segregation of duties, handoffs, exceptions, and related guidance.
- Feature guides explain purpose, controls, fields, reads, writes, statuses, notifications, exceptions, completion evidence, roles, and workflows.
- Contextual Help links resolve the exact implemented feature guide for shell, warehouse, procurement, legal, and vendor routes without duplicating controls.
- Governance guidance identifies controlled references, version/effective-date confirmation needs, status, repository, owner, and prohibited workarounds.
- Evidence screenshots expose numbered hotspots, interaction instructions, source build, environment, and review date.
- Browser history and refresh restore the selected article, workflow node, filters, and saved scroll position instead of returning to the page top.

## Roles

Live roles:

- Core: Core staff; Platform administrator.
- Vendor: Vendor portal user.
- Warehouse: Logistics supervisor; Operations; Finance; BI analyst; Business unit; Marketing; Procurement; Pricing; Warehouse administrator.
- Procurement: Requester; Officer; Approver; Finance; Procurement administrator.
- Legal: Reviewer; Compliance; Legal administrator.

Coming-soon roles remain visibly non-operational: Strategic sourcing lead, Vendor relationship manager, Inventory planner, Internal auditor, Department budget owner, and Security reviewer. They do not receive live capabilities or routes.

## Features and routes

The 49 live route patterns cover:

- Core/admin: home, sign-in, password recovery, Knowledge Base, offline state, user administration, and department DOA.
- Warehouse: dashboard, scan, tasks, inventory, receiving, allocations, returns, storage, events, procurement, purchase orders, cycle counts, quality, approvals, exceptions, finance, pricing, data, reports, suppliers, locations, imports, and operation routes.
- Procurement: request list/create/detail, approvals, purchase-order list/detail.
- Legal: case list/detail, application review, instrument signing, and vendor invitation.
- Vendor: case list/detail, application, and instrument signing.

Contextual in-screen Help is now part of the live Knowledge Base feature contract. It is no longer presented as a future feature. The remaining nine roadmap items are article publishing, search analytics, correction requests, policy traceability, sandbox walkthroughs, multilingual documentation, offline Knowledge Base, role curricula, and workflow-linked release notes.

## Workflow coverage

Live workflows cover identity and access, procure to pay, vendor accreditation, warehouse setup, receiving and putaway, quality disposition, event fulfillment, returns and reconciliation, cycle counting and adjustment, administration, allocation/event/return, pricing and costing, DOA governance, and exception recovery.

Limited workflows document current boundaries and future expansion for product master data, PO amendment/cancellation, inter-warehouse transfer, outbound fulfillment, disposal/write-off, recall/expiry/lot traceability, finance export reconciliation, access recertification/offboarding, and audit/incident handling.

Every decision has at least two labeled outcomes. Every node is reachable from its workflow start and can reach an allowed terminal outcome.

## Verification record

| Verification | Result |
| --- | --- |
| Focused graph, search, context, and evidence tests | Pass: 75/75 |
| Knowledge Base content and validation | Pass: 76/76 |
| Evidence catalog | Pass: 39 executable requirements |
| Production Next.js build | Pass: 15 routes generated; service worker bundled |
| Six-viewport Knowledge Base matrix | Initial strict run: 167 pass, 17 intentionally skipped, 2 invalid bottom-offset assertions |
| Corrected mobile workflow invariant | Pass: all 6 applicable checks at 390, 360, and 320 px |
| Combined applicable browser coverage | All 169 applicable cases passed; 17 viewport-inapplicable cases skipped |
| Manual screenshot review | Landing, search, role, workflow catalogue, desktop decision tree, and mobile decision guide inspected |

The two invalid assertions required a fixed distance from the document bottom even when responsive text wrapping changed the document height. Direct measurement showed the viewport itself moved only 7-14px. The accepted contract retains a strict 16px maximum viewport movement at every mobile size.

## Evidence release gate

The evidence validator now supports release mode and fails when `DEPLOYED_COMMIT` is absent. Use the following order:

1. Merge and deploy the application remediation.
2. Record the exact Vercel production commit.
3. Run the dedicated evidence capture against production using that commit.
4. Review all desktop/mobile images for correct state, privacy, legibility, and hotspot placement.
5. Commit the reviewed evidence manifest and images.
6. Run release verification with `KNOWLEDGE_RELEASE_VERIFICATION=1` and `DEPLOYED_COMMIT=<exact commit>`.
7. Deploy the evidence-only follow-up and verify the public Knowledge Base.

Do not relabel the `d021d170...` evidence as current. It remains valid historical reference until the post-deploy capture is accepted.

## Residual risk

- Local verification ran under Node 20.18.1 while the repository and current Supabase client target Node 22 or later. The production/CI runtime must remain Node 22+.
- This pass used deterministic memory-mode browser sessions. It does not replace a post-deploy live-Supabase transaction audit using disposable, production-safe records.
- Automated accessibility, geometry, and pixel-diversity gates cannot judge every editorial or visual nuance. The accepted screenshots received manual review, but production evidence still needs a second human privacy and instructional-accuracy review.
