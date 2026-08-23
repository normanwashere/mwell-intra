# Vendor-to-Pay Control Matrix

Date: 2026-08-23
Status: Binding code-baseline traceability; not live/UAT certification

## Governing sources

- `mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx` (canonical mWell operating source supplied for alignment; document status: updated visual draft for review)
- `MWELL_CANONICAL_POLICY_ALIGNMENT.md` (maintained direct-requirement and implementation-gap register)
- `MPIC Procurement Policy February2025.docx` and `MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md` (incorporated reference and maintained extract; not primary mWell operating authority)
- `LGL004-Vendor Accreditation Form 2.0 (3).pdf`
- `[MNDA]- Tech Service Provider.docx`

This matrix converts the supplied sources into application controls. It does not replace Legal, Finance, Procurement, or DOA approval and does not invent monetary authority. The canonical mWell source controls operating alignment; MPIC titles, named approvers, annexes and values have no mWell approval authority unless an approved mWell profile visibly inherits the control and the effective department DOA authorizes the decision.

**Activation is blocked:** the canonical source identifies itself as an updated visual draft. The application therefore keeps its profile in draft and rejects activation until Procurement records the document as approved. Neutral first/second independent variance decisions remain implementation controls until mWell names the authorized stages. The unapplied migration must remain unapplied until the controlled UAT gate.

## Process controls

| Stage | Source requirement | Authoritative owner | Required system control | Completion evidence |
|---|---|---|---|---|
| Intake | Requester owns need, budget, technical scope, timing, justification, and acceptance criteria | Requesting department | Required structured intake and attachments; requester cannot decide sourcing risk or accreditation | Submitted request with immutable requester facts |
| Routing | RFQ applies below PHP 1,000,000 when clear and comparable. RFP applies at PHP 1,000,000 and above, or at any amount for complex, technical, strategic, high-risk, data-sensitive or non-comparable work. Importation adds controls but does not automatically force RFP. Competition remains the default mode | Procurement; named approval authority comes only from the current mWell DOA | Derive and display solicitation document, procurement mode, governance tier and DOA independently. Requirement kind controls scope, acceptance and reporting, not RFQ/RFP selection | Amount and risk facts, requirement kind, solicitation document, mode, tier, profile/version/source status, reasons, reviewer, timestamp |
| Direct Award | Allowed basis, requested vendor, justification, price support, accreditation/clearance path, Procurement Head review, DOA approval | Procurement and DOA approver | Block issue until every control is present; requester facts do not equal approval | Signed exception/award record and price evidence |
| Petty cash | One-time low-value non-accredited purchase only when Finance confirms eligibility; no recurrence or splitting; OR/SI and liquidation required | Finance with Procurement visibility | Explicit one-time/non-split attestations and Finance decision; repeat use routes to accreditation | Eligibility decision, receipt, liquidation, audit trail |
| Vendor eligibility | Vendor accredited before engagement unless temporary clearance is approved | VMO; until established, Legal coordinates with Procurement | PO award/issue checks current accreditation or scoped, unexpired temporary clearance | Accreditation/clearance ID, scope, effective/expiry dates |
| Sourcing and evaluation | Accredited vendors receive equal packages, deadlines and clarifications; response sufficiency follows the approved profile; failed-bid recovery is governed; evaluation is technical and commercial; award is based on documented best value | Procurement plus technical reviewer | Versioned RFQ/RFP package, delivery evidence, profile-sourced invitation target, acknowledgment/clarification timers, response quorum, failed-bid/requote/insufficient-bids paths, tabulation, technical evaluation and no automatic winner. Any inherited numeric target or SLA must display its source | Invitations or approved pre-issue exception, communications, responses, failed-bid decision when applicable, tabulation, technical decision, award recommendation |
| Award variance | The incorporated MPIC reference names written Requestor justification, Department Head approval and Group Controller decision; the canonical mWell source does not assign those titles | Local decision-stage authorization is unresolved | Require written justification plus neutral first and second independent variance decisions. Do not present inherited titles as mWell authority until the policy owner and effective DOA authorize the mapping | Justification, two independently attributable authorized decisions, approval source, effective DOA and immutable timestamps |
| Approval | Final approval follows current DOA | Current approver tier | Resolve active matrix by department, category, amount, effective date, and delegation; prevent self-approval | Immutable step decisions and signatures |
| Commitment | Approved PO, contract, or written agreement before work begins except documented emergency | Procurement / authorized owner | Issue only after source approval, vendor eligibility, commercial match, and required protection | Issued PO/agreement and vendor acknowledgment |
| Change control | Material scope, price, vendor, delivery, or terms return for Procurement review and DOA | Procurement and DOA | Versioned amendment workflow; no silent overwrite of approved commitment | Approved amendment and before/after audit |
| Physical receipt | Delivery quantity, condition, identity, evidence, QC, and custody | Warehouse under Operations | Warehouse-only idempotent receiving; Procurement cannot post receipt | Receipt, evidence, QC disposition, stock ledger |
| Acceptance | Requesting department confirms delivery/service/technical compliance | Requester / technical reviewer | Goods acceptance references accepted Warehouse quantity; services use milestone/completion evidence | Acceptance pack and exceptions |
| Payment readiness | PO/agreement, invoice or OR/SI, receiving/acceptance, payment terms, tax/withholding support | Procurement prepares; Finance controls | Three-way evidence validation and variance queue; no payment readiness beyond accepted quantity | Payment-readiness pack and Finance decision |
| Vendor performance | Late, partial, rejected, non-conforming, breach, warranty, or claim issues documented and escalated | Requester/Project Owner, Procurement, Legal, Finance | Assigned exception, payment hold when applicable, remedy/claim tracking | Issue evidence, notices, replacement/claim/closure |
| File closure | End-to-end record retained through payment readiness, delivery closure, open issues, and warranty | Procurement plus requester | Closure checklist and unresolved-obligation blocker | Complete procurement file and closure event |

## Vendor accreditation controls

### Company and declaration

- Trade name matching registration evidence.
- Contact number, business address, incorporation date/place, TIN, email, website/fax disposition.
- Principal and correspondence contacts.
- Products/services and business/entity type.
- Manpower count and expertise, qualifications/certifications, and completed projects.
- Truth and completeness certification.
- No-pending-legal-actions declaration or disclosed details.
- Authorization for verification.
- Authorized signatory name, title, signature, and date.
- `N/A` requires an explicit field disposition and reason.

### Entity-specific evidence

| Entity | Required baseline from LGL004 |
|---|---|
| Sole proprietorship | DTI trade-name registration, business permit, BIR 2303, three-year AFS, company profile, client/transaction proof, applicable privacy/cybersecurity evidence, bank proof, official receipt, NDA |
| Partnership | SEC registration, Articles of Partnership, notarized partnership resolution, business permit, BIR 2303, three-year AFS, company profile/client proof, applicable privacy/cybersecurity evidence, bank proof, official receipt, NDA |
| Corporation | SEC registration, Articles and By-Laws, BIR 2303, three-year AFS, notarized Secretary's Certificate/Board Resolution, current GIS, business permit, company profile, expertise certifications, client/project portfolio, applicable privacy/cybersecurity evidence, bank proof, official receipt, NDA |
| Foreign vendor | Equivalent home-jurisdiction evidence where a Philippine document is not applicable, plus the approved risk/importation/payment controls |

### Technology-service-provider evidence

- Applicable NodeJS, PHP/Laravel, or mobile technology pool.
- Database, frontend, backend/API, cloud, performance, architecture, and DevOps capabilities applicable to the selected pool.
- Proven similar-project track record and dedicated technical team.
- UI/UX, Project Management, Business Analysis, and QA capability.
- Agile delivery and quality-assurance process.
- Cybersecurity policy and security-compliance evidence where applicable.
- Privacy impact/compliance evidence when personal data is handled.

The supplied form requires applicable technology capability; it does not by itself make a particular ISO certification universally mandatory. Additional requirements may block accreditation only when another approved policy, law, risk classification, or engagement-specific decision provides authority.

## Technology MNDA controls

- Correct legal names, addresses, transaction purpose, contacts, and authorized signatories.
- Confidential information limited to the potential transaction and need-to-know representatives.
- Reasonable protection and responsibility for representative disclosure.
- Data Privacy Act of the Philippines compliance and necessary consent confirmation.
- Return or destruction within five business days after written request or expiry/termination, subject to stated legal/retention exceptions.
- Effective until the earlier of two years from execution or the definitive agreement.
- Written amendment, governing law, arbitration, notice, assignment, publicity, remedy, and counterpart terms retained in the signed instrument.
- Template defects such as an unrelated vendor name must never enter generated instruments.

## Financial protection and special scenarios

| Trigger | Required treatment |
|---|---|
| Down payment | Down-payment bond equal to the down payment before release |
| Labor/manpower exposure | Payment-bond or equivalent review plus accreditation and contract controls |
| Construction | Applicable performance/warranty bonds and CARI/EARI review; PCAB/regulatory evidence where authorized |
| Equipment with installation/commissioning | Performance, warranty, insurance, commissioning, defects, and acceptance controls based on risk/value |
| Foreign vendor/importation | Incoterms, importer of record, permits, duties/taxes, landed cost, freight/insurance, customs/logistics, currency/payment risk, and acceptance point |
| Breach/non-performance | Document issue; Procurement coordinates with Finance and Legal on payment hold, replacement, notice, termination, bond/insurance/warranty claim |

## Two-person Warehouse control model

| Flow | Warehouse Operator | Warehouse Supervisor | Dual-control rule |
|---|---|---|---|
| Clean expected receipt | Scan PO/product/serial/lot, enter quantity, capture evidence, perform standard inspection, put away | Monitor queue; no routine approval required | One Operator may complete the clean path |
| Short/excess/damaged/unidentified | Record actual facts and evidence; cannot override | Decide accept/reject/quarantine/escalate within authority | Different users required |
| Quality hold | Place or maintain hold from evidence | Release or confirm rejection with reason/evidence | Holder cannot release own controlled hold |
| Putaway | Scan destination and move accepted stock | Resolve blocked/invalid location exceptions | No approval for valid route |
| Pick/issue | Pick, scan, and issue against approved demand | Resolve shortage/substitution/override | Override requires Supervisor |
| Return | Receive and inspect standard return | Decide damaged/lost/write-off or disputed custody | Exception decision separated |
| Cycle count | Perform assigned count | Approve material variance and resulting adjustment | Counter cannot approve own variance |
| Manual adjustment/write-off | Submit reason and evidence | Approve/reject within authority | Self-approval prohibited |
| Configuration | No access to role/DOA/policy administration | Maintain authorized bins/routes; platform controls remain Admin | Operational role cannot grant itself authority |

Temporary delegation can replace an absent person but cannot let one account execute and approve the same controlled transaction.

## Mandatory code-baseline scenarios

1. Clear, comparable request below PHP 1,000,000 deriving RFQ, for both goods and services classifications.
2. Request at or above PHP 1,000,000 deriving RFP and the effective DOA, regardless of goods/services classification.
3. Complex, technical, strategic, high-risk, data-sensitive or non-comparable request below PHP 1,000,000 deriving RFP; importation by itself remains RFQ-eligible when simple and comparable.
4. Three to four accredited invitees and at least three usable sealed-bid responses.
5. Fewer than three responses causing a blocked failed bid, equal-notice extension/requote recovery, and separately approved insufficient-bids recovery.
6. Valid and invalid sole-source, repeat-order, emergency, petty-cash, and other approved exception paths, including rejected split/recurring petty cash use.
7. Best-value recommendation and independently approved recommendation variance; lowest price is never an automatic winner.
8. New, approved, probation, provisional, expired, renewal-due, rejected, suspended, and exact-scope temporary-clearance vendor states.
9. Sole proprietor, partnership, corporation, foreign vendor, and technology-service-provider document branches.
10. MNDA generation, execution, expiry, return/destruction due date, and template-defect prevention.
11. Full, partial, excess, damaged, quarantined, rejected, duplicate, warranty, replacement, and RMA receiving paths.
12. Clean one-Operator receipt and every Supervisor-controlled exception, including self-approval denial.
13. Goods and service acceptance plus payment-readiness success, mismatch, missing evidence, returned correction, and release denial.
14. Importation, down payment, manpower, construction, equipment-installation, cross-role visibility, unauthorized direct RPC, concurrency, idempotency, audit, and cleanup.

Passing local tests for these scenarios is implementation evidence only. Live database activation, migration status, deployed behavior, business UAT, and the parked controlled-fixture QC alias check remain separate gates.
