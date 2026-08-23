# Canonical Mwell Procurement Policy Alignment

Date: 2026-08-23

Status: Migration applied and schema-verified in UAT; application deployment and commit-bound transaction certification in progress

## Canonical source

- File: `mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx`
- SHA-256: `51F4E381CF7DEC6A1950867C4839750078DB08D603A5DE8AA54B63D12F6D1239`
- Source status: updated visual draft for management, Legal, Procurement, Finance and requester review
- Policy owner: Procurement
- Approval authority: current effective department DOA
- Incorporated reference: `MPIC Procurement Policy February2025.docx`; inherited controls retain visible provenance and do not override the canonical mWell source

## Implemented alignment

- RFQ derives below PHP 1,000,000 only when the requirement is clear and comparable.
- RFP derives at PHP 1,000,000 and above, or at any amount for complex, technical, strategic, high-risk, data-sensitive or non-comparable work.
- Importation adds special controls without automatically forcing RFP.
- Requirement kind remains available for scope, acceptance and reporting, not solicitation selection.
- Client and SQL route derivation use the same facts and reasons.
- The exact source filename, document status, profile status, effective date and inherited control sources are represented separately.
- A profile derived from a draft source cannot be activated in client validation or the database RPC.
- Bid-extension configuration and payloads use calendar-day semantics.
- Operators see request-bound profile provenance beside inherited invite, bid-window and extension controls.
- Draft-save readiness is separate from approval-submit readiness; the approval action remains disabled until the complete server-required evidence checklist is satisfied.
- The process library, manual, specification, training content, traceability matrix, control matrix, in-app Knowledge workflow and generated standalone handbook use the canonical 13-step spine.
- Finer-grained sourcing, failed-bid, acknowledgement, inspection, quality-recovery and Finance states are labelled as system-expanded states.
- Legacy `req_*` request and purchase-order identifiers remain text throughout new solicitation and SLA evidence tables.
- Incomplete legacy drafts now fail closed into Procurement remediation instead of aborting policy migration.
- Existing sourcing RPC parameter names are preserved so additive deployment does not break PostgreSQL function identity.
- The terminal commitment-readiness boundary uses effective live capabilities; the UAT launch verifier reports zero raw capability boundaries and zero missing critical objects or read grants.
- Policy-workspace RLS evaluates effective capabilities directly while private mutation helpers remain non-executable to browser roles.
- Before controlled activation, effective-policy lookup returns a valid empty state instead of an HTTP error; Platform Admin and Legal workspace crawls are clean on desktop and mobile.
- Vendor purchase-order acknowledgement is now represented in the authoritative route and Knowledge Base coverage contracts, including vendor scope, current-revision validation, recovery guidance, and completion evidence.
- The live Vendor Representative audit now renders the purchase-order acknowledgement page on both desktop and mobile instead of certifying the vendor landing page alone.

## Verification evidence

- Procurement module: 27 test files and 192 tests passed at the aligned code baseline.
- Procurement and shell TypeScript checks passed at the aligned code baseline.
- Standalone handbook contract: 21 tests passed, covering source identity, route rules, 13-step order, six decision trees, nine role procedures, search and self-contained output.
- Disposable PostgreSQL migration matrix covers route parity, profile activation, exception review, sourcing, vendor/PO lifecycle, payment evidence, role denial, RLS, idempotency and recovery. On 2026-08-23, 114 tests passed with one intentional live-only skip; lint, typecheck and production build passed.
- UAT migration `20260822110000_mpic_procurement_policy_alignment` is recorded. Runtime read-back confirmed text request identifiers, the stable `save_sourcing_event(payload jsonb)` signature, and one incomplete draft routed to one remediation record.
- Workflow screenshot evidence now traverses the app's nested `<main>` scroll surface on desktop and mobile instead of relying on document-level full-page capture.

## Remaining release gates

- Procurement must approve the canonical source and record the source status before profile activation.
- Mwell owners must authorize the named/effective DOA mapping for the two neutral recommendation-variance decisions.
- Canonical planning SLA ranges require a versioned display/configuration control before production activation.
- Supply/delivery, development warranty, third-party liability and contractor-equipment protection applicability require first-class evidence and issue gates before production activation.
- Production activation remains blocked until Procurement approves the source/profile and the named DOA mappings are authorized.
- UAT release sign-off still requires deployment of the exact tested commit followed by governed desktop/mobile transaction, cleanup, visual and accessibility certification.
- Production claims require the same commit-bound evidence and independent database read-back against the production project; UAT evidence is not production evidence.
