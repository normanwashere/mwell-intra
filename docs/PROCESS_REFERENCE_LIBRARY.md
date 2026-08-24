# Mwell Intra Process Reference Library

**Purpose:** Place the source basis for every governed process inside the standalone handbook.

**Control rule:** This HTML appendix is an operating extract and traceability register. The approved original maintained by its business owner remains authoritative when wording differs. Do not replace a signed agreement, approved policy, active DOA revision, or completed form with this summary.

## Reference Register

| Reference document | Format and authority | Processes governed | Business owner | Handbook treatment |
| --- | --- | --- | --- | --- |
| `mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx` | Canonical mWell operating source supplied for alignment; the document identifies itself as an updated visual draft for review | Request intake, route selection, exceptions, competition, accreditation, approval, commitment, acceptance and payment readiness | Procurement, with Legal, Finance and the active department DOA owners | Primary operating basis. The app must not activate a profile derived from this source until its document status is approved. SHA-256: `51F4E381CF7DEC6A1950867C4839750078DB08D603A5DE8AA54B63D12F6D1239` |
| `MPIC Procurement Policy February2025.docx` | Incorporated reference named by the canonical mWell source | Numeric thresholds, timing and control practices that mWell has not replaced | MPIC source owner; mWell Procurement decides whether a control is inherited | Reference-only extract in `MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md`; inherited controls must retain visible provenance and cannot override the canonical mWell source or active DOA |
| `LGL004-Vendor Accreditation Form 2.0 (3).pdf` | Approved vendor accreditation form, version 2.0 / 2025 baseline | Vendor identity, declarations, entity evidence, qualification and accreditation | Legal / Vendor Management | Required fields, entity branches and declarations are reproduced below |
| `[MNDA]- Tech Service Provider.docx` | Controlled legal instrument template | Technology-provider confidentiality, privacy, execution, expiry and return/destruction | Legal | Operational clauses and lifecycle controls are reproduced below; the executed instrument controls the parties |
| `Ecomm-Order Page.xlsx` | Warehouse operating tracker supplied by stakeholders | Ecommerce order intake, customer/address data, payment, product lines, dispatch and reconciliation | Operations / Warehouse | Tracker fields are mapped to Intra fields and exports below so the spreadsheet is not re-entered |
| `wms comments (1).pdf` | Approved stakeholder feedback baseline for the August 2026 WMS release | Receiving, fulfillment, bundles, QC, delivery proof, department requests and returns | Operations / Warehouse | Accepted requirements and released behavior are summarized below |
| `Mwell_Intra_Feature_Roadmap_and_Cost_Analysis_v5_erp_benchmark_adjusted.xlsx` | Planning and benchmark source | Product scope, release sequencing and future capability assessment | Product / Steering group | Traceable launch items are maintained in the Requirements Traceability Matrix; roadmap-only items remain proposed |
| Active department DOA revision in Mwell Intra | Governed system record; effective-dated and immutable after activation | Named approval authority by department, category, amount and delegation | Department owner; administered by Platform Admin or Legal Admin | The active revision controls. Draft and temporary lists have no approval authority until activated |
| Republic Act No. 10173 and approved retention schedule | Regulatory and internal control source | Personal-data handling, evidence access, retention and deletion | Privacy, Legal and Information Security | Operational handling and retention rules are maintained in the security and retention sections |

## Current Persona Register

Mwell Intra uses the following 11 operating personas. Policy labels, job titles, and module role codes are scoped capabilities or control labels, not additional personas and not authority by themselves. Detailed permitted actions, prohibitions, handoffs, recovery paths, and application routes are maintained once in the canonical role guides; this library remains the authoritative source for policy and process controls.

<!-- canonical-personas:start -->
| Current persona | Governed operating scope |
| --- | --- |
| Platform Administrator | Identity, minimum-role, configuration, audit, and authorized DOA administration |
| General Employee | Own requests and contributions before independent review or operational release |
| Operations Associate | Attributable physical Warehouse execution and custody evidence |
| Operations Lead | Warehouse control decisions, setup, exceptions, releases, variances, and assigned approvals |
| Procurement Lead | Procurement route, sourcing, vendor-readiness, commitment, and closure evidence |
| Finance Controller | Independent valuation, matching, settlement, and payment-readiness review |
| Legal & Compliance Lead | Vendor, legal-instrument, compliance, and authorized DOA control decisions |
| Marketing & Events Lead | Event demand, custody coordination, outcome evidence, and settlement submission |
| Product Owner | Product readiness, pricing, and go-live decisions |
| Leadership / Insights | Governed read-only cross-module analysis and source tracing |
| Vendor Representative | Own-organization application, declaration, evidence, and correction submissions |
<!-- canonical-personas:end -->

## Reference-to-Process Map

```mermaid
flowchart TD
  Need[Department need] --> Proc[Procurement Policy]
  Proc --> Route{Sourcing route and exception valid?}
  Route -->|No| Correct[Return for correction]
  Route -->|Yes| Vendor{Vendor eligible?}
  LGL[LGL004 accreditation form] --> Vendor
  MNDA[Technology Provider MNDA] --> Vendor
  Vendor -->|No| Block[Block award or use approved temporary clearance]
  Vendor -->|Yes| DOA{Active department DOA approved?}
  DOA -->|No| Correct
  DOA -->|Yes| PO[Issue PO or approved commitment]
  PO --> WMS[Warehouse receiving and QC]
  WMSFeedback[WMS stakeholder feedback] --> WMS
  WMS --> Ecomm[Ecommerce pick, pack and dispatch]
  Tracker[Ecommerce order tracker] --> Ecomm
  Ecomm --> Accept[Acceptance and reconciliation]
  Accept --> Finance[Finance match and payment readiness]
  Privacy[Privacy and retention controls] --> Vendor
  Privacy --> Ecomm
  Privacy --> Finance
```

## Procurement Policy Operating Extract

Start with [Mwell Canonical Procurement Policy Alignment](policy/MWELL_CANONICAL_POLICY_ALIGNMENT.md). Consult the [maintained MPIC February 2025 extract](policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md) only for an incorporated control that the canonical mWell source does not replace. Mwell uses three separate route axes:

| Route axis | Operating rule |
| --- | --- |
| Solicitation document | Use RFQ below PHP 1,000,000 when the requirement is clear and comparable. Use RFP at PHP 1,000,000 and above, or at any amount for complex, technical, strategic, high-risk or data-sensitive work. Importation adds controls but does not automatically force RFP. An approved exception may use none when policy permits. |
| Procurement mode | Competitive bidding is the default; sole source, repeat order, emergency purchase, petty cash, or another approved exception requires its own eligibility and evidence |
| Governance tier | Standard, formal bid, high-risk/special control, and the current effective DOA are determined independently from the solicitation document |

Requirement kind remains important for scope, acceptance and reporting, but it does not select RFQ or RFP. Mwell approval authority always comes from the current effective department DOA, never from an MPIC title, person, annex or amount.

**Activation blocker:** the canonical source identifies itself as an updated visual draft. The app stores that document status and refuses to activate a policy profile until Procurement records the source as approved. The incorporated MPIC timing control is represented as at least seven working days for the initial bid window and no more than seven calendar days for an extension, with visible inherited-source provenance.

### Canonical 13-step procurement-to-payment overview

```mermaid
flowchart TD
  S1[1 Define the need] --> S2[2 Submit the request]
  S2 --> S3[3 Confirm the procurement path]
  S3 --> S4[4 Source vendors]
  S4 --> S5[5 Check accreditation]
  S5 --> S6[6 Evaluate offers]
  S6 --> S7[7 Recommend award]
  S7 --> S8[8 Approve under the active DOA]
  S8 --> S9[9 Issue PO or contract]
  S9 --> S10[10 Deliver and close delivery or service obligations]
  S10 --> S11[11 Prepare payment handoff]
  S11 --> S12[12 Process vendor payment]
  S12 --> S13[13 Close the procurement file]
```

The application may show additional controlled states for package issuance, failed-bid recovery, vendor acknowledgement, inspection, quality recovery and Finance review. These are system-expanded states mapped to the 13 policy steps; they are not extra policy stages.

### Solicitation document and type classification

```mermaid
flowchart TD
  A[Requester: classification, specification or scope, budget and acceptance evidence] --> B{System: amount and route facts complete?}
  B -->|No| BX([Blocked: request cannot route])
  BX --> BR[Requester recovery: correct classification and required evidence]
  BR --> B
  B -->|Yes| C{At least PHP 1M, or complex, technical, strategic, high-risk, data-sensitive, or not comparable?}
  C -->|No| D[Solicitation document: RFQ with scope or specification, commercial terms, deadline and attachments]
  C -->|Yes| F[Solicitation document: RFP with evaluation approach, technical and commercial requirements, response deadline and attachments]
  D --> G{Procurement: governed exception mode requested?}
  F --> G
  G -->|No| H[Route evidence: competitive bidding plus independently derived governance tier]
  G -->|Yes| I{Policy owner: exception eligibility and evidence complete?}
  I -->|No| IX([Blocked: exception cannot be used])
  IX --> IR[Recovery: correct evidence or return to competitive bidding]
  IR --> G
  I -->|Yes| J[Route evidence: approved exception mode; solicitation none unless policy owner requires supporting RFQ or RFP]
  H --> K{System: active profile and effective DOA resolved?}
  J --> K
  K -->|No| KX([Blocked: no authoritative route or approver])
  KX --> KR[Platform Admin or policy owner recovery: correct configuration without granting approval authority]
  KR --> K
  K -->|Yes| L[Procurement completion evidence: solicitation document, mode, tier, profile, DOA, reasons and reviewer]
```

### Bid quorum and failed-bid recovery

```mermaid
flowchart TD
  A[Procurement: versioned package, accredited-vendor list and common deadline] --> B{Procurement: three to four accredited vendors invited?}
  B -->|Yes| PS[Controlled package path: standard invitation evidence]
  B -->|No| BX([Blocked: invitation target not met; package cannot issue])
  BX --> X{Policy owner: current, independently approved pre-issue invitation-target exception with evidence?}
  X -->|Yes| PE[Controlled package path: exception evidence, approving owner, scope, expiry and timestamp]
  X -->|No| BT([Blocked terminal: package cannot issue without target or current exception])
  BT --> BR[Recovery: source eligible vendors or close the request with reason]
  BR --> B
  PS --> C[Vendor representatives: attributable responses, acknowledgments and clarification evidence]
  PE --> C
  C --> D{System at deadline: at least three usable responses?}
  D -->|Yes| E[Procurement: controlled bid opening and response register]
  D -->|No| F[System: failed-bid state with reason and preserved submissions]
  F --> G{Procurement: extension, additional sourcing or equal requote available?}
  G -->|Yes| H[Recovery: notify every invitee, version the package and set the revised deadline within the inherited seven-calendar-day cap]
  H --> D
  G -->|No| I{Policy owner and effective DOA: evaluation with fewer than three justified and approved?}
  I -->|No| IX([Blocked terminal: bids remain unopened and no award may proceed])
  IX --> IR[Recovery: restart competition or close the request with reason]
  IR --> B
  I -->|Yes| J[Controlled exception evidence: reason, sourcing effort, usable responses, approvers and timestamps]
  J --> E
  E --> K[Completion evidence: response set, opening event, failed-bid recovery or approved insufficient-bids decision]
```

### Exception eligibility

```mermaid
flowchart TD
  A[Requester: exception request, business facts, vendor and supporting evidence] --> B{Procurement: source-policy exception selected?}
  B -->|No| C[Recovery route: competitive bidding with RFQ for materials or RFP for services]
  B -->|Yes| D{Procurement: emergency basis?}
  D -->|Yes| E{Life, safety, environment or serious disruption evidence complete?}
  D -->|No| F{Procurement: sole-source basis?}
  F -->|Yes| G{No acceptable alternative and compatibility, specialization, capability or authorized-source proof complete?}
  F -->|No| H{Procurement: repeat-order basis?}
  H -->|Yes| I{Same vendor, price, terms and considerations; prior competition; age at most one year; amount at most PHP 250,000?}
  H -->|No| J{Finance: petty-cash basis?}
  J -->|Yes| K{At most PHP 2,000 source value, eligible, one-time, not split, and receipt or liquidation evidence planned?}
  J -->|No| L{Policy owner: another source exception specifically approved?}
  E -->|No| X([Blocked: emergency exception ineligible])
  G -->|No| X
  I -->|No| X
  K -->|No| X
  L -->|No| X
  X --> R[Recovery: correct facts or return to competitive bidding]
  R --> B
  E -->|Yes| M[Exception evidence pack and retrospective PO obligation]
  G -->|Yes| M
  I -->|Yes| M
  K -->|Yes| M
  L -->|Yes| M
  M --> N{System: accredited vendor or approved scoped clearance, owner review and effective DOA complete?}
  N -->|No| NX([Blocked: exception cannot authorize commitment])
  NX --> NR[Recovery: complete Legal, Procurement, Finance or DOA handoff]
  NR --> N
  N -->|Yes| O[Completion evidence: exception type, eligibility facts, approvals, price support and audit trail]
  C --> P[Completion evidence: competitive route restored]
```

### Best-value award and recommendation variance

```mermaid
flowchart TD
  A[Procurement and technical reviewer: commercial tabulation, technical evaluation and source evidence] --> B{System: evaluation records complete and current?}
  B -->|No| BX([Blocked: no award recommendation])
  BX --> BR[Recovery: complete or correct attributed evaluation evidence]
  BR --> B
  B -->|Yes| C[Procurement: best-value rationale across technical, quality, delivery, total cost, warranty, support, price, payment and training]
  C --> D{Procurement: recommended vendor matches evaluated best value?}
  D -->|Yes| H{Effective DOA and separation of duty approve award?}
  D -->|No| E{Requester: written variance justification complete?}
  E -->|No| EX([Blocked: unexplained variance])
  EX --> ER[Recovery: accept evaluated recommendation or write complete justification]
  ER --> D
  E -->|Yes| F{First independent variance decision authorized and approved?}
  F -->|No| FX([Denied: variance rejected])
  FX --> FR[Recovery: revise recommendation or sourcing evidence]
  FR --> C
  F -->|Yes| G{Second independent variance decision authorized and approved?}
  G -->|No| GX([Blocked: independent variance decision missing])
  GX --> GR[Recovery: resolve the authorized local decision stage and effective DOA assignment; do not substitute an MPIC title]
  GR --> G
  G -->|Yes| H
  H -->|No| HX([Blocked or denied: no award commitment])
  HX --> HR[Recovery: return for correction, re-evaluation or closure with reason]
  HR --> B
  H -->|Yes| I[Completion evidence: recommendation, rationale, variance decisions when applicable, DOA steps and immutable award]
```

### Receiving, quality and RMA

```mermaid
flowchart TD
  A[Vendor: acknowledged PO or agreement and delivery notice evidence] --> B{Warehouse or service owner: delivery or milestone tied to approved commitment?}
  B -->|No| BX([Blocked: do not accept or make payment-ready])
  BX --> BR[Recovery: identify commitment or quarantine and investigate]
  BR --> B
  B -->|Yes| C{Warehouse: physical goods?}
  C -->|No| D{Service owner: milestone and acceptance criteria satisfied?}
  D -->|No| DX([Blocked: service acceptance withheld])
  DX --> DR[Recovery: vendor corrects service or owner records approved exception]
  DR --> D
  D -->|Yes| J[Acceptance evidence: owner, scope, date and result]
  C -->|Yes| E[Warehouse: quantity, identity, condition, serial or lot, custody and receipt evidence]
  E --> F{Quality reviewer: accepted and conforming?}
  F -->|Yes| J
  F -->|No| G[Warehouse and Procurement: reject or quarantine; record vendor notice and payment hold]
  G --> H{Procurement: replacement, warranty or RMA evidence issued?}
  H -->|No| HX([Blocked: quality issue remains open])
  HX --> HR[Recovery: issue notice, RMA, credit or replacement request]
  HR --> H
  H -->|Yes| I{Replacement, repair or credit completed and inspected?}
  I -->|No| IX([Blocked: monitor open vendor obligation and retain payment hold])
  IX --> IR[Recovery: escalate overdue obligation and update evidence]
  IR --> I
  I -->|Yes| E
  J --> K[Completion evidence: receipt or service acceptance, QC disposition, RMA trail when applicable and resolved custody]
```

### Payment evidence and file closure

```mermaid
flowchart TD
  A[Procurement: payment-readiness pack linked to request, sourcing, award and commitment] --> B{System: approved PO or agreement and itemized invoice or OR or SI present?}
  B -->|No| BX([Blocked: Finance review cannot start])
  BX --> BR[Recovery: Procurement obtains and links missing commitment or invoice evidence]
  BR --> B
  B -->|Yes| C{System: receipt or service acceptance complete and within accepted quantity or value?}
  C -->|No| CX([Blocked: payment exceeds acceptance or acceptance is missing])
  CX --> CR[Recovery: Warehouse or service owner corrects receipt or acceptance; Procurement refreshes pack]
  CR --> C
  C -->|Yes| D{Finance: invoice reconciles to PO or agreement, terms and approved variance?}
  D -->|No| DX([Blocked: discrepancy queue and payment hold])
  DX --> DR[Recovery: correct invoice, commitment, variance or acceptance evidence]
  DR --> D
  D -->|Yes| E{Finance: tax, withholding and foreign-vendor evidence complete when applicable?}
  E -->|No| EX([Blocked: statutory or payment-control evidence missing])
  EX --> ER[Recovery: obtain valid tax and foreign-payment support]
  ER --> E
  E -->|Yes| F{Finance Controller: payment readiness approved under current authority?}
  F -->|No| FX([Denied or returned: no payment release])
  FX --> FR[Recovery: address the recorded denial or correction reason and resubmit]
  FR --> A
  F -->|Yes| G[Payment-readiness evidence: Finance decision, pack version, accepted cap and audit trail]
  G --> H{Procurement: delivery closed, open issues resolved and retention pack complete?}
  H -->|No| HX([Blocked: procurement file remains open])
  HX --> HR[Recovery: close delivery, quality, warranty, variance or evidence obligations]
  HR --> H
  H -->|Yes| I[Completion evidence: payment readiness plus governed procurement-file closure]
```

### Operating rules

- The requester records the need, line items, timing, budget context, business justification, alternatives, risk if not procured, technical scope and acceptance criteria. Requester preference is not route approval.
- Procurement confirms all three route axes and retains the applicable active-profile snapshot. Direct Award is a legacy label only where mapped to an approved exception mode; a checkbox is never approval.
- Invitations target three to four accredited vendors. Sealed-bid opening requires at least three usable responses or an approved failed-bid recovery/insufficient-bids decision.
- Every invitee receives the same versioned package, clarification and deadline notice. Technical and commercial evidence remains attributable.
- A differing best-value recommendation requires written justification plus a first independent variance decision and a second independent variance decision. These neutral stages are usable only after Mwell policy/DOA owners authorize the stages and the effective DOA assigns the actors; current code names are not authority.
- Do not activate a profile derived from the canonical mWell draft until Procurement records the source document as approved. The extension control is already modeled in calendar days and remains visibly attributed to the incorporated MPIC reference.
- The system resolves named approvers from the active department DOA by scope, amount, category, effective date and delegation. Self-approval is prohibited.
- A PO, contract or written agreement is issued only after request, route, vendor eligibility, sourcing, commercial, protection and approval evidence is complete. Material change returns to Procurement and DOA review.
- Warehouse records physical quantity, identity, condition, evidence, QC disposition and custody. The service owner records milestone acceptance. Procurement cannot manufacture either record.
- Finance validates the approved commitment, invoice or OR/SI, receipt or service acceptance, payment terms, tax/withholding, foreign-vendor support and resolved variance. A mismatch remains blocked until corrected.

## LGL004 Vendor Accreditation Operating Extract

### Common vendor facts and declarations

- Trade name and registration identity, contact number, business address, incorporation place/date, TIN, email and web/fax disposition.
- Principal and correspondence contacts, products/services, entity type, manpower, expertise, qualifications, certifications and completed projects.
- Truth and completeness certification, pending-legal-actions declaration or disclosure, consent to verification, and authorized signatory name, title, signature and date.
- A field that does not apply must be explicitly marked `N/A` with a reason; blank does not mean not applicable.

### Entity evidence branches

| Entity | Baseline evidence |
| --- | --- |
| Sole proprietorship | DTI registration, business permit, BIR 2303, three-year AFS, company profile, client/transaction proof, applicable privacy/cybersecurity evidence, bank proof, official receipt and NDA |
| Partnership | SEC registration, Articles of Partnership, notarized partnership resolution, business permit, BIR 2303, three-year AFS, company/client evidence, applicable privacy/cybersecurity evidence, bank proof, official receipt and NDA |
| Corporation | SEC registration, Articles and By-Laws, BIR 2303, three-year AFS, notarized Secretary's Certificate or Board Resolution, current GIS, business permit, company profile, expertise/client evidence, applicable privacy/cybersecurity evidence, bank proof, official receipt and NDA |
| Foreign vendor | Approved equivalent home-jurisdiction evidence plus applicable importation, tax, payment and risk controls |

### Technology-provider qualification

When applicable, capture the selected technology pool and evidence for database, frontend, backend/API, mobile, cloud, performance, architecture, DevOps, delivery history, named technical team, UI/UX, project management, business analysis, QA, agile delivery, cybersecurity and privacy. A certification is mandatory only when the approved form, law, policy, risk classification or engagement-specific Legal decision requires it.

## Technology Provider MNDA Operating Extract

- Use correct legal names, addresses, purpose, contacts and authorized signatories for both parties.
- Limit confidential information to the potential transaction and need-to-know representatives.
- Record execution and effective dates. The instrument remains effective until the earlier of two years from execution or the definitive agreement, unless the executed text states otherwise.
- Preserve Data Privacy Act obligations and required consent confirmation when personal data is handled.
- Track written return/destruction requests and the five-business-day completion deadline, subject to the executed instrument's legal and retention exceptions.
- Preserve amendment, governing-law, dispute, notice, assignment, publicity, remedy and counterpart terms in the executed version.
- Never generate an instrument from a template containing an unrelated vendor or stale party detail.

## Ecommerce Tracker-to-Intra Mapping

| Tracker information | Intra record | Entry point and control |
| --- | --- | --- |
| Order number and order date | Fulfillment order identity and timestamps | Import or create once; duplicate external order IDs are rejected |
| Shop or sales channel | Controlled sales-channel value | Choose the released channel value; unknown values fail validation |
| Customer name, contact and address | Customer and delivery destination | Address presets assist but the operator confirms province, postal code and service area |
| Payment method, payment reference and Maya status | Order payment fields | Maya status is required only when applicable; Finance evidence remains role-controlled |
| SKU, product, quantity and selling price | Order lines and Product-owned commercial snapshot | Product owns selling price; Warehouse cannot edit it during fulfillment |
| Bundle identity and set quantity | Bundle flag, generated set ID and component scans | Each physical set receives its own set ID; ordinary quantity is not automatically a bundle |
| Rack/bin and serial number | Pick source and serialized pick evidence | Scan the displayed location before each serialized unit; wrong-location and duplicate scans fail |
| Packaging supply | Packaging-consumption lines | Scan or select pouch, box, paper bag, label, wrap, tape or approved freebie consumed by the order |
| Waybill, courier and tracking | Dispatch fields | Waybill and courier are required before release; failed-delivery status remains traceable |
| Proof and release/handover details | Uploaded proof, release event and generated handover reference | Proof is uploaded directly; release is attributable to the acting user and timestamp |
| Delivery outcome | Delivery tracking and closure | Delivered, failed delivery, return-to-sender and other allowed outcomes require role authority and evidence |

The **Export current view** function produces one row per order line with order, customer, address, payment, product, commercial, dispatch, handover and audit fields. It is a controlled handoff, not a second tracker that users must maintain.

## WMS Feedback Reference Extract

- Receiving exposes PO and delivery-receipt references, delivery date, batch/lot or serial details, evidence and a legible receipt-line table.
- Fulfillment supports order and event work in a list/table view, bulk order intake while automation is pending, bundle/set identification, rack/bin scans and serialized picking.
- Quality Control records disposition, evidence, reason and the resulting putaway, hold, quarantine or vendor-return path.
- Delivery updates include a generated handover reference and direct image/proof upload with explicit permission checks.
- Department requests support multiple line items in one request and preserve allocation, issue, outcome and reconciliation.
- Returns distinguish a specific event return from a specific receiving/fulfillment return and use serial lookup to preserve origin.

## Document Ownership and Change Control

1. The business owner approves changes to the governing original.
2. Product and Engineering update the mapped controls, procedures, tests and this reference library in the same release.
3. Legal reviews changes to accreditation, privacy, confidentiality, retention or instruments.
4. Finance reviews changes to DOA, valuation, payment, tax, write-off or reconciliation controls.
5. Operations validates Warehouse, fulfillment, return, event and custody behavior in UAT.
6. The release manifest records source checksums and the deployed commit. A changed source with an unchanged handbook blocks release certification.

## Flow-First Handbook Source Rules

The standalone handbook renders its governed operational journeys from the maintained manual. Each of the following journeys must lead with an overview flow, completion criteria, role/handoff view, and a decision/exception view: procurement to payment, vendor accreditation, receiving and putaway, ecommerce fulfillment, returns and replacements, inventory release, event custody, and inventory integrity.

The overview is the primary lifecycle statement. Role and decision views explain who may act and what happens when normal progression is blocked. Diagrams complement, but never replace, source records, policy evidence, role assignments, or released application controls.
