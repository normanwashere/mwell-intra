# Mwell Intra Platform Integration Design

**Date:** 2026-07-10

**Status:** Revised for policy-owner review

**Product boundary:** Mwell Intra is the product. Warehouse, Legal, Vendor, Procurement, Finance, and Admin are components of the same protected operating platform.

**Deployment target:** `https://mwell-intra.vercel.app/`

## Authoritative Policy Sources

The following supplied documents are controlling sources for this release:

1. `LGL004-Vendor Accreditation Form 2.0 (3).pdf`, identified in the document as Vendor Accreditation Form v.2025.
2. `[MNDA]- Tech Service Provider.docx`, the Legal master for mutual confidentiality with technology service providers.
3. `mWell Procurement Policy and Procedures - Revised Modern Visual Updated.docx`, including its annexes, approval, exception, financial-protection, importation, and payment-readiness controls.

Requirements must be traceable to a source document, source version, section or form field, effective date, and policy owner. The application stores the policy/template version used for each submitted request, accreditation application, declaration, checklist, instrument, award recommendation, and approval. Later policy changes apply prospectively unless Legal or Procurement explicitly starts a governed remediation or renewal.

Where these documents are silent, the application must not invent a monetary threshold, bid quorum, approval authority, legal term, or mandatory document. Such items enter a `policy_decision_required` state and are routed to the policy owner. Current code assumptions are not policy merely because they already exist.

Known source-quality issues must be resolved by Legal before the MNDA is generated in production. The supplied template contains a hard-coded execution date, an `NCS` party reference where `SERVICE PROVIDER` is intended, and an `NCS PHILIPPINES` signature-table label. The system must use a Legal-approved clean master with placeholders; it must not silently alter substantive clauses or reproduce those template defects.

### Current Implementation Remediation Gates

The following known implementation behavior is incompatible with the supplied sources and blocks production promotion:

- The current technology MNDA content uses a five-year survival period and exclusive Metro Manila court jurisdiction. It must be replaced by a generated, versioned instrument that preserves the supplied two-year/definitive-agreement condition, return-or-destroy obligation, and PDRCI arbitration terms.
- The current Legal catalog includes additional generally useful statutory, tax, labor, governance, and international evidence and marks some of it mandatory. The v.2025 form is the accreditation baseline. An additional requirement may become mandatory only when its own legal/regulatory/policy source, applicability rule, version, and approving owner are recorded; otherwise it remains optional guidance and cannot block submission or approval.
- The current Procurement engine contains proposed PHP 50,000 petty-cash and PHP 100,000 small-purchase thresholds and fixed two-quote/three-bid rules. They cannot govern live transactions without an approved Finance/Procurement source.
- The current approval ladder and role resolver contain placeholder monetary bands and allow demo/platform-admin role heuristics to stand in for named DOA assignments. Live approval must resolve from a versioned approved matrix and preserve segregation of duties.
- Local demo stores and seeded records may support development, but no policy decision, accreditation, award, PO, receiving handoff, or payment-readiness decision may use them in the deployed live mode.

These items require code, migration, data-remediation, and test changes. Existing records created under an incompatible rule are not silently rewritten; the migration identifies affected drafts/cases, assigns a review state, and preserves prior evidence.

## 1. Objective

Complete Mwell Intra as a coherent internal operating platform instead of treating Warehouse as the application and the other areas as attachments.

The release must let authorized users progress work across department boundaries, understand ownership and status, and verify that every important action is persisted and auditable. The app must remain usable on desktop, tablet, and mobile without weakening server-side authorization.

## 2. Release Scope

### Included

- Authenticated Command Center.
- Legal vendor accreditation and document governance.
- External Vendor Portal.
- Procurement request, approval, award, and purchase-order workflow.
- Warehouse receiving, quality, storage, inventory, allocation, count, return, and reporting workflow.
- First-class Finance workspace for MVP handoff, reconciliation, valuation, review, and corrections.
- First-class Admin workspace for users, scoped roles, audit, environment health, and launch governance.
- Cross-module handoffs and visible activity evidence.
- Supabase Auth, Postgres, Storage, RLS, controlled RPCs, and authenticated server routes.
- PWA behavior and responsive UI from 320px through 1440px.
- Repeatable local and designated-test-project release gates.

### Excluded From This Release

- Full general ledger or accounts-payable implementation.
- BIR 2307 issuance.
- Live ERP, ecommerce, courier, payment, or BI integration.
- Odoo implementation, hosting, licenses, or migration.
- RFID.
- Production test mutations using real business records.

MVP integration remains governed CSV/file handoff. Later integrations must consume the same audited transaction boundaries rather than bypass them.

## 3. Information Architecture

The authenticated shell owns global identity, navigation, notifications, theme, command palette, route protection, error reporting, and service-worker lifecycle.

| Route | Product area | Primary responsibility |
| --- | --- | --- |
| `/` | Command Center | Assigned work, approvals, handoffs, exceptions, and module entry |
| `/legal` | Legal | Accreditation queue, case review, document gates, decisions, signing |
| `/vendor` | Vendor Portal | Vendor-owned application, documents, status, and corrections |
| `/procurement` | Procurement | Requests, sourcing basis, approval ladder, award, PO handoff |
| `/warehouse` | Warehouse | Receipt through inventory custody, issue, return, count, and reporting |
| `/finance` | Finance | Reconciliation, valuation, governed exports, review, and correction |
| `/admin` | Admin | Governance overview, users, roles, audit, health, and launch controls |

### Route Migration

- `/warehouse/finance` remains a temporary compatibility redirect to `/finance`.
- `/admin/users` remains a supported child route under the new `/admin` workspace.
- Existing Legal, Vendor, Procurement, and Warehouse deep links remain stable.
- Redirect parameters remain same-origin relative paths only.

## 4. Command Center

The Command Center is the first authenticated screen and must reflect the whole platform.

It shows:

- Modules available to the current user.
- Work assigned to the current user.
- Approvals waiting on the current user.
- Cross-module handoffs that are blocked or ready.
- High-severity exceptions and failed jobs.
- Recent activity relevant to the user's roles.
- Backend/environment state without exposing technical secrets.

Cards must open real protected routes. Counts must come from repositories or governed read models, not independent local demo stores in live mode.

Users with no module role receive a clear no-access state and an administrator contact path. A Core Platform Administrator does not automatically gain department access.

## 5. Department Workflows

### 5.1 Vendor And Legal

1. The Vendor Management Office owns accreditation when that office exists. Until then, Legal through Atty. Pooja coordinates accreditation and temporary clearance with Procurement.
2. Legal or the authorized accreditation owner invites a vendor through an authenticated server boundary. The vendor account is linked to one vendor record.
3. The vendor selects its legal entity type and completes the v.2025 form as structured data: trade name matching BIR Form 2303, contact number, business address, incorporation date and place, TIN, email, website, fax when applicable, principal/owner/partner details, correspondence contact, products/services, business type, manpower count and expertise, qualifications/certifications, and completed projects.
4. The system derives the exact entity-specific checklist from the v.2025 form and records `N/A` with a reason where the form permits it. Foreign vendors may submit an equivalent document, but the equivalence decision belongs to the accreditation owner and is audited.
5. Sole proprietorship requirements include DTI trade-name registration, current business permit, three years of audited financial statements, company profile, client history with contact details, applicable privacy and cybersecurity evidence, bank-account proof, official receipt evidence, and NDA.
6. Partnership requirements include SEC registration, articles of partnership, BIR Form 2303, notarized partnership resolution, three years of audited financial statements, current business permit, company profile, client history with contact details, applicable privacy and cybersecurity evidence, bank-account proof, official receipt evidence, and NDA.
7. Corporation requirements include SEC registration with articles and by-laws, BIR Form 2303, three years of audited financial statements, notarized Secretary's Certificate or Board Resolution, updated General Information Sheet, current business permit, expertise certifications, company profile, client/project portfolio with contact details, applicable privacy and cybersecurity evidence, bank-account proof, official receipt evidence, and NDA.
8. Technology-service providers additionally declare applicable expertise against the supplied NodeJS, PHP/Laravel, and mobile-development pools, with reviewer remarks. Qualification review records the relevant stack, full-stack/API/database/cloud/DevOps or mobile capabilities, delivery roles, similar-project track record, technical team, agile practice, QA process, and security standards. A vendor can qualify for one or more pools; a non-technology vendor is not forced through this technology-only section.
9. Each document is uploaded privately, virus/type/size checked, versioned, reviewed independently, and marked approved, correction required, waived with authority and reason, or not applicable with authority and reason. Replacing a file preserves the prior evidence and review history.
10. Before submission, an authorized vendor signatory attests that the information and documents are true and correct, declares litigation/foreclosure/bankruptcy/legal-action status, authorizes MPHTC verification, confirms the consequences of false or incomplete disclosure, and signs and dates an immutable application snapshot.
11. The system replaces the form's email instruction with a governed queue and notifications to the current accreditation owner and Legal mailbox. Email is notification, not the system of record.
12. Legal reviews checklist requirements, requests corrections, and records decisions. Approval is blocked until every mandatory item for the snapshotted checklist is approved or has an authorized, reasoned disposition.
13. Procurement may use a non-accredited vendor only through a written justification and approved temporary clearance with follow-up accreditation tasks. A one-time petty-cash vendor follows the separate Finance-controlled exception in Section 5.2.
14. Accreditation state, scope, effective date, expiry/renewal state, temporary-clearance conditions, and evidence snapshot become the authoritative Procurement vendor gate.

#### Technology-Service MNDA

- The supplied MNDA is mutual and is used for technology service providers. Other vendor categories require the correct Legal-approved instrument rather than reusing the technology template by convenience.
- Generated fields include execution date, service-provider legal name and registered address, potential-transaction description, notice contact/name/address/fax/email, vendor signatory name/designation, and the approved MPHTC signatory details.
- The agreement limits use to the potential transaction, restricts disclosure to representatives with a need to know, requires no less than reasonable care, and records that each party remains responsible for its representatives.
- The Data Privacy Act of the Philippines obligations and necessary-consent warranty remain part of the instrument. Instrument access, download, and signature events are audited and limited to authorized parties.
- The effective term is the earlier of two years from execution or execution of definitive agreements implementing the potential transaction. The system calculates both conditions and must not substitute the current five-year application text.
- A written request, expiry, or termination creates a return-or-destroy obligation due within five business days, with a retention exception only where law, regulation, professional standard, or internal retention policy requires it. Completion evidence and any retained-copy basis are recorded.
- Amendments require a written instrument signed by authorized representatives of both parties. Assignment, notices, public disclosures, and compelled-disclosure notices are tracked as governed Legal events where invoked.
- Governing law is the Republic of the Philippines. Disputes use PDRCI arbitration, three arbitrators, Makati seat and venue, and English language as stated in the supplied master; the application must not replace this with exclusive court jurisdiction.
- The instrument is complete only after both authorized parties sign. Each signature binds an exact document hash and template version; the final countersigned file is private, immutable, and retrievable through short-lived audited access.

Required negative paths include wrong-vendor access, unsafe upload, missing requirement, expired accreditation, unauthorized decision, duplicate submission, and signing-link expiry.

### 5.2 Procurement

1. A requester owns the business need, budget, technical scope, timeline, previous cost, acceptance criteria, and business justification. The requester supplies facts but cannot select the final sourcing route or waive Procurement controls.
2. A requester drafts a purchase request with line items and governed attachments. Complete intake includes budget evidence, scope/specifications, target date, acceptance criteria, vendor/market facts, payment terms and documents, and applicable risk/importation answers.
3. Procurement confirms the route. Use RFQ/canvassing below PHP 1,000,000 when requirements are clear and comparable. Use RFP/bidding at PHP 1,000,000 and above, or at any amount for complex, technical, strategic, high-risk, or data-sensitive work. Importation alone does not force RFP.
4. The supplied policy does not approve the current application assumptions for PHP 50,000 petty cash, PHP 100,000 small purchase, RFQ two-quote quorum, or RFP three-bid quorum. These controls must be removed from hard-coded launch logic unless Finance/Procurement supplies an approved current matrix. The system instead records vendors invited, responses, deadline compliance, sourcing effort, and an insufficient-bids exception when Procurement proceeds with fewer responses than intended.
5. Direct Award is limited to a documented sole supplier, emergency, repeat/continuity case with no known vendor issue, or other approved exception. The pack requires requested vendor, exception basis, business justification, supporting evidence, price reasonableness, vendor accreditation or temporary-clearance state, operational/legal/financial/delivery/data risk and mitigation, Procurement Head review, and final DOA approval.
6. Emergency procurement records the threat to life, safety, environment, operations, patient/service continuity, or serious business disruption; minimizes verbal commitments; captures retrospective documents and approvals; and creates the PO/contract as soon as practicable.
7. One-time purchase from a non-accredited vendor through petty cash is available only after Finance confirms eligibility. The requester attests that it is not recurring or split, supplies OR/SI or receipt and liquidation support, gives Procurement/Finance visibility, and routes repeat use to accreditation or temporary clearance. No unapproved amount threshold is encoded.
8. Importation requires Incoterms/shipping terms, importer of record, permits/licenses/registrations, customs broker/logistics, duties/taxes, freight/insurance/storage, foreign exchange and bank charges, total landed cost, vendor export documents, foreign-payment timing, delivery/acceptance point, warranty/defect treatment, and Legal/Finance risk review where applicable.
9. Submission locks the request, evidence, route decision, policy version, and applicable approval matrix version. Approvers act only on their assigned active step and cannot self-approve where separation is required.
10. Final monetary and commitment approval comes from the current Delegation of Authority or approved matrix. Placeholder amount ladders or demo-role heuristics cannot authorize a live award. Department/technical review, Procurement Head/commercial review, Finance, Legal, and Final Approver participate only when the policy/matrix and risk facts require them.
11. Procurement records equivalent RFQ/RFP communications, proposal receipt and deadline compliance, commercial tabulation, technical assessment, accreditation status, recommendation, risks, exceptions, endorsements, and the Award Recommendation. Material clarifications are shared fairly with invited bidders where bidding applies.
12. Financial-protection review is structured, not a generic attachment prompt: payment bond for labor exposure; down-payment bond equal to the VAT-exclusive advance; performance bond generally 30% for construction, supply/delivery, and specified services; warranty bond generally 10% for construction/build/development warranty exposure; SBLC generally 30% for foreign-vendor cases where approved; CARI/EARI generally at least 100% for applicable works; and other insurance based on policy triggers and approved exceptions.
13. PO/contract issuance requires an eligible vendor, approved award, matching scope/vendor/price/payment/delivery/warranty/protection terms, and one canonical PO handoff. Vendor work cannot start before the approved PO, contract, or written agreement except under the documented emergency path.
14. Material post-approval changes to scope, price, vendor, delivery timeline, or terms trigger Procurement review and reapproval under the active DOA; they do not overwrite the approved version.
15. The issued PO becomes visible to Warehouse receiving without a duplicate local PO record.
16. The requester records delivery/service completion and technical acceptance. Procurement prepares payment readiness; Finance owns payment processing and release timing. Payment is blocked without the PO/agreement match, invoice or OR/SI, receiving/acceptance evidence, milestone support, tax/withholding support, and Finance handoff.
17. Closure records payment state, acceptance, warranty/support obligations, open claims/issues, and complete procurement-file evidence. Vendor failure can trigger notice, payment hold, replacement, termination, bond/insurance/warranty claim, or other Legal/Finance-coordinated remedy.

Required negative paths include threshold boundaries, stale approval, skipped tier, self-approval, unaccredited vendor, duplicate PO, unauthorized attachment access, and rejected/resubmitted requests.

### 5.3 Warehouse

Warehouse retains the implemented W1 control model but participates in the Intra-wide handoff contract.

1. Warehouse receives an issued Procurement PO.
2. Receiving records exact quantities, lots, serials, evidence, and idempotency.
3. Quality inspection accepts, holds, rejects, releases, or creates a vendor return.
4. Accepted stock is put away into governed locations and bins.
5. Allocation, issue, return, transfer, and cycle count preserve exact-unit custody.
6. Variances and controlled adjustments use Supervisor/Finance approval where required.
7. Inventory position and movement evidence feed Finance and Command Center read models.

No Warehouse screen may own a parallel vendor, PO, Finance, or role source of truth in live mode.

### 5.4 Finance

Finance becomes a first-class Intra area while remaining deliberately narrower than an accounting system.

It provides:

- Inventory valuation and landed-cost visibility.
- Movement, receipt, hold, return, and adjustment reconciliation.
- Event and promotional inventory usage summaries.
- Governed export jobs with checksum, creator, reviewer, timestamps, correction lineage, and short-lived download.
- Review, correction, and sign-off states.
- Read-only visibility for BI where granted.

Finance data comes from security-invoker read models and controlled export functions. Direct client-only Blob exports are not launch evidence.

### 5.5 Admin

Admin becomes a workspace rather than a single role matrix.

It includes:

- `/admin`: governance overview and launch health.
- `/admin/users`: profiles, account status, scoped role assignment, and deprovisioning controls.
- `/admin/audit`: searchable actor, module, entity, action, timestamp, result, and correlation ID.
- `/admin/health`: environment checks, migration compatibility, storage availability, service worker state, and integration readiness.

Admin does not grant itself department authority. Role mutations use controlled RPCs, require explicit confirmation, and create immutable audit records.

## 6. Cross-Module State Model

The core launch flow is:

```text
Vendor invited
  -> entity-specific application completed
  -> vendor declaration signed
  -> accreditation evidence reviewed
  -> applicable instrument countersigned
  -> Legal/VMO accredited or temporary clearance approved
  -> Procurement intake complete
  -> Procurement route confirmed
  -> sourcing/evaluation/exception evidence complete
  -> DOA approval ladder completed
  -> purchase order issued
  -> Warehouse receipt staged
  -> quality accepted or exception routed
  -> stock put away
  -> requester acceptance recorded
  -> payment-readiness pack complete
  -> Finance payment/reconciliation reviewed
  -> warranty/claim obligations closed
```

Every transition records:

- Transaction or command ID.
- Actor from the server-validated session.
- Previous and resulting state.
- Source and destination entity references.
- Timestamp and correlation/idempotency key.
- Visible activity/audit evidence.

Downstream modules read canonical upstream state. They do not infer authorization or readiness from copied labels, browser storage, or user-provided status fields.

## 7. Identity And Authorization

- Supabase Auth is the live identity provider.
- The browser verifies sessions with `auth.getUser()` before projecting a profile.
- Authorization claims use `app_metadata`, never user-editable metadata.
- Roles remain module-scoped: `core`, `legal`, `procurement`, and `warehouse`; Finance access is initially expressed through approved Finance/BI capabilities while the database contract is migrated deliberately.
- Client checks control presentation only. RLS and controlled RPC/server boundaries are authoritative.
- Core Platform Admin has governance capabilities but no implicit Legal, Procurement, Warehouse, or Finance authority.
- Vendor users are restricted to their linked vendor record and private document paths.

## 8. Supabase And Storage Boundaries

- Every Data API table has RLS enabled and forced where the current contract requires it.
- Anonymous table/function/storage access is revoked unless explicitly public and documented.
- Exposed RPC wrappers use invoker semantics and delegate to guarded private implementations where needed.
- Private `SECURITY DEFINER` functions remain outside exposed schemas, set a safe `search_path`, validate actor/capability/state, and revoke default execution.
- Views exposed to authenticated users use `security_invoker = true` or remain inaccessible.
- Procurement, Legal, Finance, and Warehouse evidence lives in private buckets.
- Signed URLs are short-lived, capability checked, and audited.
- The service-role key is server-only and never appears in public environment variables, browser bundles, logs, or committed examples.

New-project compatibility must account for Supabase Data API exposure no longer being automatic. Required schema/table/function grants are explicit in migrations.

## 9. Frontend And Responsive Standards

The shared shell and design system define the visual contract across modules.

- Desktop uses persistent global navigation and dense operational layouts.
- Mobile uses bottom navigation in the thumb zone, with overflow areas in a named sheet/menu.
- Department navigation remains secondary to global Intra navigation.
- All interactive targets are at least 44px.
- No page-level horizontal overflow is allowed from 320px through 1440px.
- Sticky actions, sheets, keyboards, and safe areas must not overlap bottom navigation.
- Tables become mobile cards or contained, named, keyboard-focusable scroll regions.
- Empty, loading, error, offline, conflict, denied, success, and partial states are visually distinct.
- Dark and light themes preserve WCAG A/AA contrast and status meaning.
- Decorative artwork never obstructs operational copy or actions.

## 10. Error, Offline, And Conflict Handling

- Authentication and protected-route failures fail closed.
- Server/API errors show a user-facing recovery action plus a correlation ID.
- Client errors are reported without credentials, document payloads, or sensitive form data.
- Offline writes are allowed only for the documented Warehouse floor allowlist.
- Legal decisions, Procurement submission/approval, role changes, governed exports, and other high-risk commands require connectivity.
- Retried commands use idempotency keys.
- Stale/concurrent updates return a deterministic conflict state and never silently overwrite canonical data.

## 11. Verification Strategy

### Deterministic Local Gates

- Unit/domain/repository tests for every state transition and policy boundary.
- Policy-fixture tests for v.2025 accreditation requirements by entity type, technology-provider qualification, declarations, temporary clearance, and foreign-equivalent review.
- Golden-document tests proving generated technology MNDAs use the approved clean master, correct parties, two-year/definitive-agreement term, five-business-day return/destruction obligation, PDRCI clause, and exact document hash.
- Procurement decision-table tests at PHP 999,999.99 and PHP 1,000,000; complexity/risk overrides; Direct Award; emergency; insufficient bids; petty-cash exception; importation; financial protection; material change; payment readiness; and closure.
- Tests proving unapproved petty-cash/small-purchase thresholds, fixed bid quorums, and placeholder DOA tiers cannot authorize a live transaction.
- API route tests for authentication, authorization, validation, and error handling.
- Static migration checks for RLS, grants, safe search paths, effective function definitions, and migration order.
- Repository-wide lint, typecheck, dependency audit, and Node 22+ production build.

### Intra-Wide Browser Gates

Test all canonical personas across:

- Desktop 1440x900 and 1280x800.
- Tablet 768x1024.
- Mobile 390x844, 360x800, and 320x720.
- Light and dark themes where applicable.

Required browser evidence includes:

- Login, logout, reset, safe redirect, and hard-reload session restoration.
- Command Center and every accessible/denied module route.
- Vendor application and Legal review/correction/decision.
- Entity-specific accreditation checklists, signed declaration, technology-pool review, temporary clearance, and foreign-equivalent decision.
- MNDA generation, vendor signature, MPHTC countersignature, expiry/definitive-agreement completion, and return-or-destroy task.
- Procurement request, tier approvals, award, and PO handoff.
- RFQ/RFP boundary, complexity/risk route override, insufficient bids, Direct Award, emergency, petty-cash exception, importation, bond/insurance review, material change, acceptance, payment readiness, and claim/closure.
- Warehouse receipt, quality, putaway, issue, return, count, and exception.
- Finance export, download, review, and correction.
- Admin role assignment, audit search, and health states.
- Cross-module happy paths, negative paths, duplicate submits, refresh persistence, and dead-end detection.
- Geometry, target size, overlap, accessibility, console, and screenshot review.

The complete responsive visual crawl runs three times. Automated screenshots require named Product/UX review before launch.

### Live Test-Project Gates

Live tests run only against a designated Supabase test project with synthetic records prefixed by a run ID.

They prove:

- Authorized write and canonical read-back.
- Wrong-role, wrong-vendor, and anonymous denial.
- Fresh-browser-session persistence.
- Audit/ledger evidence.
- Idempotency and concurrency invariants.
- Controlled cleanup or business reversal without deleting immutable evidence.

Production data is never mutated for QA.

## 12. Deployment And Rollback

1. Complete local gates on the Intra integration branch.
2. Apply migrations to the designated test project and run advisors/security checks.
3. Run all live personas and cross-module workflows.
4. Complete Product, Warehouse, Legal, Procurement, Finance, Admin, Security, and UX sign-off.
5. Push the reviewed branch and deploy a Vercel preview.
6. Repeat smoke, auth, PWA, and critical workflow checks on the preview.
7. Promote to `mwell-intra.vercel.app` only with explicit go/no-go approval.
8. Monitor health, auth, client errors, failed jobs, approval age, handoff age, and inventory invariants during hypercare.

Rollback triggers include cross-user data exposure, unauthorized state changes, login outage, unrecoverable transaction errors, duplicate financial/inventory movements, negative stock, broken private-file access, or unexplained audit loss.

Rollback preserves logs and immutable evidence, freezes writes when necessary, restores the prior application deployment, and applies only tested database recovery procedures.

## 13. Implementation Order

1. Platform route and RBAC contracts for first-class Finance/Admin.
2. Command Center and shared shell/navigation alignment.
3. Finance workspace extraction and governed read/export flows.
4. Admin overview, audit, health, and safer role administration.
5. Legal/Vendor and Procurement live repository completion.
6. Canonical cross-module handoffs and activity read models.
7. Whole-app responsive/accessibility remediation.
8. Intra-wide local E2E, visual evidence, and performance/security gates.
9. Designated Supabase test-project verification.
10. Vercel preview, post-deploy audit, and controlled production promotion.

## 14. Acceptance Criteria

Mwell Intra is ready for production promotion only when:

- All seven product areas are reachable through the authenticated shell according to scoped roles.
- Finance and Admin are first-class routes and no longer presented as Warehouse appendages.
- The complete Vendor-to-Finance launch flow progresses through canonical persisted state.
- Every accreditation application is reproducible from its v.2025 structured-data, checklist, evidence, declaration, review, and policy-version snapshot.
- Technology-service MNDAs are generated only from a Legal-approved clean master and match the supplied substantive terms; both parties sign the same immutable hash.
- Procurement route, exception, approval, financial-protection, acceptance, and payment-readiness controls match the supplied policy and current approved DOA matrix.
- No live authorization depends on the current unapproved small-purchase thresholds, quote quorums, or demo approval-role heuristics.
- Every high-risk action is server authorized, auditable, and persistent across a fresh session.
- Private documents and exports have governed access and no public leakage.
- All local, live test-project, responsive, accessibility, security, and build gates pass.
- Three full visual crawls pass and receive named review.
- There are zero open P0/P1 defects and every P2 has an owner or approved waiver.
- Cutover, rollback, support, training, and hypercare owners have signed off.

Until those criteria are met, the release may be code-complete or test-ready but must not be described as production-ready.
