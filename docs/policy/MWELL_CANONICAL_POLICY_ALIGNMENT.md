# Mwell Canonical Procurement Policy Alignment

## Authority

The governing requirements source for this alignment is:

- `mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx`
- SHA-256: `51F4E381CF7DEC6A1950867C4839750078DB08D603A5DE8AA54B63D12F6D1239`
- Source status: **Updated visual draft for management, Legal, Procurement, Finance, and requester review**
- Policy owner: **Procurement**
- Approval authority: the current effective Mwell Delegation of Authority or approval matrix

The MPIC Procurement Policy is an incorporated reference named by the canonical Mwell source. It is not the primary operating authority. An MPIC control may be inherited only when the Mwell source does not replace it, and its source must remain visible.

No application screen, migration, handbook, training output, or release certificate may claim that this draft source or a DOA is approved or active until the accountable owners activate the corresponding versioned records.

## Direct Mwell Requirements

| Area | Canonical rule | Required system behavior |
|---|---|---|
| Intake ownership | Requester owns need, budget, scope, timeline, previous cost, acceptance criteria, and justification | Requester records facts; Procurement confirms route and vendor readiness |
| RFQ | Below PHP 1,000,000 when requirements are clear and comparable | Competitive route recommends RFQ only when amount is below the boundary and no RFP trigger exists |
| RFP | PHP 1,000,000 and above, or complex, technical, strategic, high-risk, data-sensitive or non-comparable regardless of amount | Any named trigger recommends RFP; the boundary is inclusive |
| Importation | Adds customs, landed-cost, permits, logistics, insurance, foreign-payment, and acceptance controls | Importation alone does not force RFP, but adds a high-control plan and may coexist with RFQ or RFP |
| Direct Award | Sole supplier, emergency, continuity/repeat, or approved exception | Require basis, supplier, justification, price support, vendor status, Procurement Head review, and current DOA approval |
| Petty cash | One-time low-value non-accredited purchase only when Finance confirms eligibility | Require non-split/non-recurring attestation, OR/SI or liquidation evidence, and Procurement/Finance visibility; recurring vendors enter accreditation or temporary clearance |
| Accreditation | Accredited before engagement unless scoped temporary clearance is approved | VMO owns when available; otherwise configurable Legal owner coordinates with Procurement; do not hard-code a person as authorization |
| Evaluation and award | Technical and commercial review, understandable best-value recommendation, AR, and current DOA | No automatic lowest-price award; preserve technical review, commercial tabulation, risk, variance, and independent approval evidence |
| Commitment | Approved PO, contract, or written agreement before work starts except documented emergency | Bind vendor, scope, price, terms, warranty, and financial protections; material changes re-enter review and DOA |
| Acceptance and payment | PO/agreement, invoice or OR/SI, acceptance or receiving evidence, milestone support, tax/withholding, Finance handoff | Payment remains blocked until the complete evidence pack is linked and current |
| Financial protection | Down-payment bond equals down payment; performance bond generally 30%; warranty bond generally 10%; construction PHP 5M+, manpower regardless of amount, installation/commissioning, foreign-vendor, CARI/EARI, and claim controls | Derive and evidence the applicable protection review before commitment or payment |
| SLA planning | Petty cash 1-3, RFQ 5-7, RFP 15-25, Direct Award 5-10, accreditation 5-10, importation +10-30, payment readiness 3-5 business days | Show planning ranges from complete-intake/acceptance start conditions; do not present them as automatic promises |

## Canonical 13-Step Spine

1. Define need.
2. Submit request.
3. Confirm path.
4. Source vendors.
5. Check accreditation.
6. Evaluate offers.
7. Recommend award.
8. Approve under the current DOA.
9. Issue PO, contract, or written agreement.
10. Deliver and close operational work.
11. Prepare payment handoff.
12. Process vendor payment.
13. Close the complete procurement file.

The application may expose more granular internal states, but every state must map to one of these steps. A system-expanded flow must be labelled as such and must not be described as the policy's own step count.

## Alignment Findings

| Priority | Baseline finding | Current disposition |
|---|---|---|
| P0 | Shared route code and SQL selected RFQ/RFP from materials versus services | Resolved in code and migration: amount/risk routing is shared; requirement kind remains scope/acceptance/reporting data |
| P0 | Client helper text taught that requirement type determined RFQ/RFP | Resolved in request UI and route explanation copy |
| P0 | Migration source identity referenced the superseded Mwell filename and treated MPIC as the governing parent profile | Resolved: exact canonical filename/hash/status are bound; MPIC is visibly incorporated reference only |
| P0 | Maintained docs taught a goods-RFQ/services-RFP rule and a 14-stage policy flow | Resolved in maintained sources: canonical 13-step spine is primary; granular states are labelled system-expanded |
| P1 | Extension controls used working-day semantics although the incorporated MPIC reference says calendar days | Resolved in TypeScript, UI, SQL payload and deadline arithmetic as calendar days |
| P1 | Numeric petty-cash, repeat-order, quorum and timing controls were presented as directly required by Mwell | Resolved in maintained guidance, profile attribution and the sourcing workspace; final owner confirmation remains a profile-activation gate |
| P1 | Canonical SLA ranges are not first-class profile/display controls | Open: add versioned planning SLA ranges and start-condition display before production activation |
| P1 | Source status was not represented separately from an activated operating profile | Resolved in types, adapter, Admin UI, SQL constraint and activation RPC; live migration remains unapplied |
| P1 | The request UI could enable approval submission while the server still required previous-cost, quotation/proposal or award-recommendation evidence | Resolved: draft-save readiness and approval-submit readiness are separate; approval submit mirrors the complete evidence checklist |
| P1 | Financial-protection derivation does not yet represent every supply/delivery, development warranty, third-party liability and contractor-equipment assessment named by the canonical source | Open: add explicit applicability decisions, evidence types and server/client issue gates before production activation |

## Release Gates

- Shared TypeScript and SQL route derivations return the same result at the PHP 1M boundary and for every named risk trigger.
- Importation-only requests remain eligible for RFQ when below PHP 1M and otherwise simple/comparable.
- Requester UI says that Procurement confirms the route and never lets the requester approve risk, accreditation, Direct Award, or DOA.
- Policy filename, hash, source status, profile status, effective dates, control sources, and DOA version are visible and attributable.
- Direct Award, petty cash, accreditation, financial protection, receiving/acceptance, payment readiness, and closure negative paths fail closed.
- Maintained Markdown and generated standalone HTML use the 13-step policy spine and clearly label any expanded application flow.
- UAT migration remains unapplied until the controlled Supabase/RLS certification task.
