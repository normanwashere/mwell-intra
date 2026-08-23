# Mwell Intra Technical and Functional Specification

**Reviewed:** August 23, 2026
**Procurement application behavior baseline:** `0bf88e362acec9ee8f5c59dbda865a8d4767e4a2`
**Evidence status:** local code and documentation baseline; not live/UAT certification

## Product boundary

Mwell Intra is the shared operating platform for cross-department workflows. Warehouse, Procurement, Legal, Finance, Product, Marketing, Operations, Customer Service, and platform administration use scoped modules over a shared Supabase authority model. Warehouse is a component of Intra, not a separate application.

## Runtime architecture

- Next.js shell deployed on Vercel.
- Modular React workspaces under `modules/`.
- Supabase Auth for identity and session management.
- PostgreSQL schemas, row-level security, guarded functions, and immutable activity records for live authority.
- Role and capability resolution controls routes, commands, records, and onboarding curricula.
- The standalone operating handbook is packaged with each certified release and maps guidance to current routes, roles, process diagrams and governing references.

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

| Axis | Values | Derivation and enforcement |
| --- | --- | --- |
| Solicitation document | `rfq`, `rfp`, `none` | RFQ derives below PHP 1,000,000 when clear and comparable. RFP derives at PHP 1,000,000 and above, or for complex, technical, strategic, high-risk, data-sensitive or non-comparable work at any amount. Importation alone does not force RFP. An approved exception may derive none when policy permits. |
| Procurement mode | `competitive_bidding`, `sole_source`, `repeat_order`, `emergency_purchase`, `petty_cash`, approved other exception | Competition is default; each exception requires server-validated eligibility, evidence, owner review, and current DOA |
| Governance tier | `standard`, `formal_bid`, `high_risk`, plus effective DOA route | Amount, complexity, technical/strategic risk, data sensitivity, category, active profile and current DOA determine control depth; route reasons preserve every triggering fact |

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

## Release and documentation controls

Every operational release must update:

1. Standalone operating handbook content and diagrams.
2. User manual.
3. Training and operations manual.
4. This technical and functional specification.
5. Training and handover content.
6. A dated release note.

CI compares operational source changes with this documentation set. `pnpm docs:build` compiles the maintained sources and embedded screenshots into the searchable, printable, self-contained `docs/manual/index.html`. `pnpm verify:release-documentation` rejects a release when that HTML no longer matches its sources. UAT certification generates a commit-bound manifest and bundles the consolidated HTML with current desktop/mobile audit screenshots. Production deployment is blocked when required documentation is stale.
