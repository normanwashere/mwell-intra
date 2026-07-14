# Vendor-to-Pay Control Matrix

Date: 2026-07-15
Status: Binding implementation and UAT traceability baseline

## Governing sources

- `mWell Procurement Policy and Procedures - Revised Modern Visual Updated.docx`
- `LGL004-Vendor Accreditation Form 2.0 (3).pdf`
- `[MNDA]- Tech Service Provider.docx`

This matrix converts the supplied sources into application controls. It does not replace Legal, Finance, Procurement, or DOA approval and does not invent monetary authority.

## Process controls

| Stage | Source requirement | Authoritative owner | Required system control | Completion evidence |
|---|---|---|---|---|
| Intake | Requester owns need, budget, technical scope, timing, justification, and acceptance criteria | Requesting department | Required structured intake and attachments; requester cannot decide sourcing risk or accreditation | Submitted request with immutable requester facts |
| Routing | RFQ below PHP 1,000,000 when simple/comparable; RFP at/above PHP 1,000,000 or complex, technical, strategic, high-risk, or data-sensitive | Procurement | Policy recommendation plus Procurement confirmation; amount alone cannot downgrade complex/high-risk work | Recorded route, reasons, reviewer, timestamp |
| Direct Award | Allowed basis, requested vendor, justification, price support, accreditation/clearance path, Procurement Head review, DOA approval | Procurement and DOA approver | Block issue until every control is present; requester facts do not equal approval | Signed exception/award record and price evidence |
| Petty cash | One-time low-value non-accredited purchase only when Finance confirms eligibility; no recurrence or splitting; OR/SI and liquidation required | Finance with Procurement visibility | Explicit one-time/non-split attestations and Finance decision; repeat use routes to accreditation | Eligibility decision, receipt, liquidation, audit trail |
| Vendor eligibility | Vendor accredited before engagement unless temporary clearance is approved | VMO; until established, Legal coordinates with Procurement | PO award/issue checks current accreditation or scoped, unexpired temporary clearance | Accreditation/clearance ID, scope, effective/expiry dates |
| Sourcing and evaluation | Fair comparable requirement/deadline; technical and commercial evaluation; understandable award recommendation | Procurement plus technical reviewer | Common RFQ/RFP package, proposal receipt controls, technical evaluation, commercial comparison | Proposals, tabulation, technical decision, AR |
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

## Mandatory certification scenarios

1. RFQ below threshold and RFP at threshold.
2. Low-value complex/data-sensitive RFP.
3. Valid and invalid Direct Award.
4. One-time petty cash and rejected split/recurring use.
5. New, approved, provisional, expired, renewal-due, rejected, and suspended vendor.
6. Sole proprietor, partnership, corporation, foreign vendor, and technology-service provider document branches.
7. MNDA generation, execution, expiry, return/destruction due date, and template-defect prevention.
8. Full, partial, excess, damaged, quarantined, rejected, and duplicate Warehouse receipt.
9. Clean one-Operator receipt and every Supervisor-controlled exception.
10. Self-approval denial for receipt override, hold release, variance, adjustment, and write-off.
11. Goods and service acceptance, including accepted-with-exceptions.
12. Payment readiness success, mismatch, missing evidence, returned correction, and release denial.
13. Importation, down payment, manpower, construction, and equipment-installation controls.
14. Cross-role visibility, unauthorized direct RPC, concurrency, idempotency, audit, and cleanup.
