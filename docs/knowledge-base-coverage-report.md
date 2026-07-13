# Knowledge Base Release Coverage Report

Reviewed: 2026-07-13

Branch: `codex/knowledge-base-operating-handbook`

Reviewed branch range: `4f2623e..f604cab`

Final reviewer verdict: **READY** (no current P0-P3 findings after capture isolation)

Evidence source commit: `edb3609d20eea7eb27a59f1a6d8dfcf9163048b9`

## Release verdict

**Ready for merge and deployment.** The registry validator reports zero route, feature, or graph gaps, the content/evidence set is complete, and the DOA-authority and contention-induced timeout findings are resolved. Serial verification passes the Knowledge Base, lint, typecheck, unit, production-build, and responsive browser gates. The final accepted handbook matrix passed 96/96 across all six viewports. Evidence generation is excluded from normal E2E and runs only through the dedicated single-project maintenance command.

## Contract coverage

| Contract | Coverage | Result |
| --- | ---: | --- |
| Roles | 20 live + 6 coming soon = 26 | Complete |
| Features | 48 live + 10 coming soon = 58 | Complete |
| Live route patterns | 48 | Every route has live feature documentation |
| Knowledge articles | 115 | Owners and review dates present |
| Principal workflows | 14 | All graph nodes reachable and terminating |
| Decision nodes | 38 | Authority and policy fields present |
| Terminal nodes | 46 | 15 complete, 12 escalated, 11 revision, 6 rejected, 2 cancelled |
| Evidence | 39 desktop/mobile pairs = 78 screenshots | 78 unique SHA-256 hashes |
| Responsive test sizes | 1440x900, 1280x800, 768x1024, 390x844, 360x800, 320x720 | Exercised; final accepted matrix 96/96 |

The generated `buildKnowledgeCoverage` result contains zero errors and zero warnings. This means there are **zero unexplained live route/feature coverage gaps**. Cross-registry regression coverage now also enforces that Administration DOA authority is limited to Platform and Legal administrators, with Procurement explicitly review-only.

## Roles

Live roles:

- Core: Core staff; Platform administrator.
- Vendor: Vendor portal user.
- Warehouse: Logistics supervisor; Operations; Finance; BI analyst; Business unit; Marketing; Procurement; Pricing; Warehouse administrator.
- Procurement: Requester; Officer; Approver; Finance; Procurement administrator.
- Legal: Reviewer; Compliance; Legal administrator.

Coming-soon roles are visible but non-operational: Strategic sourcing lead, Vendor relationship manager, Inventory planner, Internal auditor, Department budget owner, and Security reviewer. They have no live capabilities or routes and cannot satisfy live coverage.

## Features and routes

The 48 live features map one-to-one to the 48 live route patterns below. Dynamic IDs and signing codes are documented as route parameters.

- Core/admin: `/`, `/login`, `/reset-password`, `/knowledge`, `/~offline`, `/admin/users`, `/admin/doa`.
- Warehouse: `/warehouse`, `/warehouse/scan`, `/warehouse/tasks`, `/warehouse/inventory`, `/warehouse/inventory/:id`, `/warehouse/receiving`, `/warehouse/allocations`, `/warehouse/returns`, `/warehouse/storage`, `/warehouse/events`, `/warehouse/events/:id`, `/warehouse/procurement`, `/warehouse/purchase-orders`, `/warehouse/cycle-counts`, `/warehouse/quality`, `/warehouse/approvals`, `/warehouse/exceptions`, `/warehouse/finance`, `/warehouse/pricing`, `/warehouse/data`, `/warehouse/reports`, `/warehouse/suppliers`, `/warehouse/locations`, `/warehouse/imports`, `/warehouse/operation-routes`.
- Procurement: `/procurement`, `/procurement/requests/new`, `/procurement/requests/:id`, `/procurement/approvals`, `/procurement/purchase-orders`, `/procurement/purchase-orders/:id`.
- Legal: `/legal`, `/legal/cases/:id`, `/legal/cases/:id/application`, `/legal/cases/:id/sign/:code`, `/legal/invites/new`.
- Vendor: `/vendor`, `/vendor/cases/:id`, `/vendor/cases/:id/application`, `/vendor/cases/:id/sign/:code`, `/vendor/invites/new`.

The 10 coming-soon feature references are CMS publishing, contextual help, search analytics, correction feedback, policy traceability, sandbox walkthroughs, multilingual documentation, offline Knowledge Base, onboarding curricula, and workflow-linked release notes.

## Workflows and decisions

| Workflow | Nodes | Edges | Decisions | Terminal outcomes |
| --- | ---: | ---: | ---: | ---: |
| Identity and access | 7 | 7 | 2 | 2 |
| Procure to pay | 20 | 32 | 9 | 5 |
| Vendor accreditation | 14 | 20 | 7 | 5 |
| Warehouse setup | 5 | 4 | 0 | 1 |
| Receive to putaway | 10 | 10 | 3 | 4 |
| Quality disposition | 8 | 9 | 2 | 3 |
| Event fulfillment | 10 | 11 | 3 | 5 |
| Returns and reconciliation | 9 | 11 | 2 | 2 |
| Cycle count and adjustment | 10 | 10 | 2 | 4 |
| Administration | 10 | 14 | 4 | 4 |
| Allocation, event, and return | 6 | 5 | 1 | 3 |
| Pricing and costing | 6 | 5 | 1 | 3 |
| DOA governance | 6 | 5 | 1 | 3 |
| Exception and recovery | 5 | 5 | 1 | 2 |

All 38 decision nodes have at least two labeled outcomes, all reachable paths can reach a valid terminal, and all 46 terminals use an allowed outcome. Graph structure passes automated validation.

## Evidence and ownership

Every executable evidence item has desktop and mobile captures, a route, role, state, actionable hotspot, reviewed date, app commit, dimensions, and SHA-256 hash. The capture report records Node `v22.17.0` for parent and server processes. All 78 hashes are unique. Capture and review dates are 2026-07-13.

Content review dates span 2026-07-11 through 2026-07-13. Registered ownership includes Platform, Product and Platform, Warehouse, Procurement, Legal, module administrators, accountable decision owners, Warehouse Finance/Logistics, and authorized Quality owners. Generic generated owner labels (`admin`, `warehouse`, `procurement`, `legal`) remain valid registry values but should be normalized to title case in a later editorial cleanup.

## Sensitive-data review

Scans were run from the repository root with generated dependencies and Git internals excluded. Commands are shown in generalized form so the report does not reproduce any secret value.

| Scan | Command/method | Result |
| --- | --- | --- |
| JWTs | `rg -l --pcre2 '<three-part JWT pattern>'` across source/docs | 0 literals |
| Assigned secrets | `rg -l --pcre2 '<service-role, audit-password, OIDC assignment patterns>'` | 0 literal assignments |
| Password literals | `rg -l --pcre2 '<password assignment pattern>'` | 0 literals |
| Private keys | `rg -l 'BEGIN ... PRIVATE KEY'` | 0 keys |
| Production bundle | Same JWT/secret assignment scan plus fixed demo-password scan over `apps/shell/.next` | 0 matches |
| PNG metadata | Node parser inspected `tEXt`, `zTXt`, and `iTXt` chunks in all Task 8 PNGs | 78 files; 0 text chunks; 0 flags |
| Screenshot text | Windows Media OCR over all 78 Task 8 screenshots | 78 processed; 0 credential/token flags |

OCR found only documented synthetic identities: the `@mwell.demo` profile set, the placeholder `you@mwell.com`, and `ops@acme.com` for the fictional Acme Medical Supplies vendor. The two initial “vendor record” keyword flags were manually inspected and contained only that fictional company/contact fixture. Source email scanning found test domains (`.test`, `.demo`, `example.com`) and named seed identities under `@mwell.com.ph`; those named identities occur only in tests, demo seed data, and the demo-auth migration and are treated as synthetic fixtures. No real customer record, real vendor record, password, token, or private key was identified.

## Verification record

All commands used an explicitly pinned Node `v22.17.0` parent and PATH.

| Command | Result |
| --- | --- |
| `pnpm verify:procurement-contract` | Pass |
| `pnpm verify:launch-artifacts` | Pass |
| `pnpm verify:knowledge-base` serial run | Pass: 76/76 |
| `pnpm lint` | Pass: 9/9 tasks |
| `pnpm typecheck` | Pass: 9/9 tasks |
| `pnpm test` serial run | Pass: 168/168, including evidence hashing and warehouse imports |
| `pnpm build` | Pass; 12 static pages generated and production bundle scanned |
| Final handbook Playwright suite | Pass: 96/96 across 1440, 1280, 768, 390, 360, and 320 in 6.4 minutes |
| Exact CI E2E discovery (`tests/smoke tests/e2e`) | Pass: 840 tests in 14 files; evidence capture excluded |
| Evidence maintenance discovery | Pass: exactly 1 test in 1 single-worker project |
| `git diff --check` | Pass |

Earlier session-restoration, handbook-navigation, search-interception, zero-scroll, workflow-timeout, evidence-hash, and import timeout reports did not reproduce under serial verification. The scroll lifecycle now exercises the application's real save and restore behavior with a strict 16px save tolerance and 64px post-layout restoration tolerance while explicitly rejecting return-to-top behavior. The final reviewer accepted the full gate with no current findings.

## Critical findings and required actions

No open P0-P3 findings remain for the handbook release scope. Evidence regeneration is a maintenance operation and must use `pnpm --filter @intra/shell capture:knowledge-evidence`; it must not be added back to normal sharded E2E.

## Residual risk

- The content registry is structurally complete, and the Administration DOA authority boundary is cross-validated. Other future policy-sensitive authority changes still require matching cross-registry regression coverage.
- OCR is machine-assisted and may miss stylized or low-contrast text; all 78 images were also reviewed during the accepted evidence remediation, but a second human privacy review remains appropriate before public documentation use.
- This pass used memory/demo E2E state. It does not replace a post-deploy live-Supabase transaction audit with disposable production-safe test records.
- Live-Supabase transactional validation remains a separate post-deployment requirement using disposable production-safe records.
