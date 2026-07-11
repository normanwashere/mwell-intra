# Mwell Intra User Manual and Knowledge Base

**Audience:** All authenticated employees and vendors

**Live app:** https://mwell-intra.vercel.app

**Interactive Knowledge Base:** https://mwell-intra.vercel.app/knowledge

**Reviewed:** July 11, 2026

**Content owners:** Platform, Procurement, Legal, Warehouse

The live Knowledge Base is the primary manual. Search by task, role, module, acronym, error, or workflow. Documentation is visible to every authenticated user; live operational routes still enforce role-based access.

## Start Here

1. Sign in with your assigned Mwell identity.
2. Open **Knowledge Base** from the desktop rail, mobile **More** menu, Home workspace, or command palette.
3. Search the outcome you need, such as `receive stock`, `PR`, `vendor renewal`, `bins`, or `DOA`.
4. Filter by role, module, or content type.
5. Open a procedure or interactive flow. Use live-route links only when your assigned role permits the operation.

Never share passwords, tokens, private keys, or confidential documents in support messages or screenshots.

## Navigation

- **Desktop:** left icon rail; hover an icon for its label.
- **Mobile:** bottom navigation; additional modules and Knowledge Base are under **More**.
- **Command palette:** `Ctrl+K` or `Cmd+K` opens task and destination search.
- **Live badge:** the session is connected to Supabase.
- **Access denied:** the documentation remains available, but the operational route requires a role review.

## User Types and Responsibilities

| User type                      | Primary responsibility                                       | Main handoff              |
| ------------------------------ | ------------------------------------------------------------ | ------------------------- |
| Core staff                     | Find the correct governed workflow and complete shared tasks | Platform Admin for access |
| Platform Admin                 | Identities, scoped roles, audit review, DOA access           | Department owner          |
| Vendor portal                  | Application, evidence, instruments, corrections, renewal     | Legal                     |
| Warehouse Logistics Supervisor | Receiving, inspection, tagging, putaway                      | Operations / Finance      |
| Warehouse Operations           | Allocation, issue, transfer, return, reconciliation          | Business unit / Finance   |
| Warehouse Finance              | Valuation, variance, reconciliation, approvals               | Warehouse Admin           |
| Warehouse BI Analyst           | Governed analysis and reports                                | Operational owners        |
| Warehouse Business Unit        | Inventory demand and outcome confirmation                    | Operations                |
| Warehouse Marketing            | Event demand, custody, usage, return                         | Operations                |
| Warehouse Procurement          | Receivable PO and supplier coordination                      | Logistics Supervisor      |
| Warehouse Pricing              | Landed cost and controlled price proposals                   | Finance                   |
| Warehouse Admin                | Locations, areas, bins, routes, imports                      | Logistics Supervisor      |
| Procurement Requester          | Need, justification, line items, evidence                    | Procurement Officer       |
| Procurement Officer            | Sourcing route, competition, vendor readiness, PO            | Approver / Warehouse      |
| Procurement Approver           | Named DOA decision                                           | Next approval tier        |
| Procurement Finance            | Financial approval, acceptance, payment readiness            | Finance processing        |
| Procurement Admin              | Procurement controls and exception oversight                 | Platform / Legal          |
| Legal Reviewer                 | Evidence, instruments, risk, accreditation decision          | Vendor / Procurement      |
| Legal Compliance               | Compliance disposition, expiry, renewal                      | Legal Admin               |
| Legal Admin                    | Invitations, Legal workflow, department DOA                  | Vendor / Legal Reviewer   |

## Comprehensive Launch Flow

```mermaid
flowchart LR
  Staff[Employee or Vendor] --> Auth[Supabase sign-in and role resolution]
  Auth -->|correct access| Work[Assigned workspace]
  Auth -->|incorrect access| Admin[Platform Admin role review]
  Admin --> Work
  Work --> PR[Requester creates purchase request]
  PR --> POps[Procurement Officer confirms sourcing route]
  POps --> DOA{Named DOA approvals complete?}
  DOA -->|no| Return[Return or reject with reason]
  Return --> PR
  DOA -->|yes| PO[Procurement authors and issues PO]
  Invite[Legal Admin invites vendor] --> Apply[Vendor application and evidence]
  Apply --> Review[Legal and Compliance review]
  Review -->|correction| Apply
  Review --> Instruments[Required instruments]
  Instruments --> Accredited{Accredited?}
  Accredited -->|no| Block[PO award remains blocked]
  Accredited -->|yes| PO
  PO --> Receive[Warehouse receives against PO]
  Receive --> Inspect{Quality disposition}
  Inspect -->|accepted| Putaway[Putaway into valid bin]
  Inspect -->|hold or damage| Hold[Evidence-backed hold or vendor return]
  Putaway --> Allocate[Operations allocates and issues]
  Allocate --> Event[Business or marketing use]
  Event --> ReturnStock[Return, consume, lose, or damage]
  ReturnStock --> Reconcile[Inspect and reconcile]
  Reconcile --> Accept[Business acceptance]
  Accept --> Pay[Finance payment readiness]
```

## Procurement Flow

```mermaid
flowchart TD
  A[Requester drafts need and line items] --> B[Justification, budget context, evidence]
  B --> C[Procurement confirms policy and sourcing route]
  C --> D{Competition or exception evidence sufficient?}
  D -->|no| B
  D -->|yes| E[Resolve effective department DOA]
  E --> F[Named approvers act in sequence]
  F -->|return or reject| B
  F -->|approved| G[Author and approve PO]
  G --> H[Issue to accredited vendor]
  H --> I[Receipt, inspection, and acceptance]
  I --> J[Payment readiness]
```

### Requester

Use **Procurement -> New request**. Choose category, enter complete line items, explain need and alternatives, attach evidence, review the sourcing preview, save the draft, and submit only after route confirmation.

### Officer and Administrator

Confirm policy route, competition or exception pack, accreditation, and request completeness. Author a PO only from an approved eligible request. Preserve request, PO, receipt, and acceptance links.

### Approver and Finance

Act only on the step assigned to your identity. Review the current request version, amount, route, evidence, and comments. Approve, reject, or return with a specific reason.

## Vendor Accreditation Flow

```mermaid
flowchart TD
  Invite[Legal Admin creates invitation] --> Identity[Secure vendor Auth identity]
  Identity --> Profile[Vendor profile and declarations]
  Profile --> Evidence[LGL004-aligned evidence]
  Evidence --> Legal[Legal and Compliance review]
  Legal -->|correction required| Evidence
  Legal --> Tech[Technology qualification when applicable]
  Tech --> Sign[MNDA and required instruments]
  Sign --> Decision{Accreditation decision}
  Decision -->|approved| Eligible[Eligible for governed procurement award]
  Decision -->|conditional| Remedy[Complete remediation]
  Decision -->|rejected| Closed[Closed with reason]
  Eligible --> Renewal[Expiry and renewal monitoring]
```

Vendors can see only their organization. Legal must not approve incomplete, expired, inconsistent, or unsupported evidence. Procurement must verify active accreditation before award.

## Warehouse Flow

```mermaid
flowchart TD
  Setup[Admin creates warehouse, areas, bins, routes] --> PO[Receivable PO]
  PO --> Receipt[Logistics records product, quantity, lot or serial]
  Receipt --> Inspection{Inspect stock}
  Inspection -->|accepted| Bin[Putaway to valid bin]
  Inspection -->|hold| Hold[Controlled hold with evidence]
  Inspection -->|vendor return| VR[Vendor return and custody]
  Bin --> Available[Available inventory]
  Available --> Reserve[Operations reserves allocation]
  Reserve --> Issue[Scan and issue custody]
  Issue --> Outcome{Final outcome}
  Outcome -->|returned| ReturnInspect[Inspect return and restock]
  Outcome -->|consumed| Consume[Record consumption]
  Outcome -->|lost or damaged| Exception[Exception and stock-change approval]
  ReturnInspect --> Reconcile[Reconcile issued totals]
  Consume --> Reconcile
  Exception --> Reconcile
  Reconcile --> Count[Cycle count and variance review]
  Count --> Finance[Valuation and reporting]
```

### Setup and Bins

Warehouse Admin creates the site, storage areas, scannable bins, and allowed operation routes. Verify destinations before receiving production stock.

### Receiving and Inspection

Select the PO and destination, record each line, scan serial/lot details, and attach evidence. Inspection supports accepted, hold, damaged, unavailable, and vendor-return outcomes. Non-accepted outcomes require a reason and evidence.

### Allocation, Events, and Returns

Reserve only available non-held stock. Scan custody on issue. Record consumed, returned, lost, and damaged quantities. Close the event only after all issued quantity reconciles.

### Counts and Adjustments

Create a count draft, record physical quantity and evidence, review variance, and post only an approved stock-change request. Never edit stock levels directly.

## DOA Administration

Platform Admin or Legal Admin opens **Admin -> Delegation of Authority**. Select **Create revision** on the current department matrix, update version and named assignments, save a draft, validate gaps/overlaps/final approval, and activate deliberately. Active records are immutable; activation supersedes the prior revision and preserves history.

## Troubleshooting and Recovery

| Situation                      | Action                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Sign-in remains on login       | Verify identity, request reset, or ask Platform Admin to confirm provisioning           |
| Access denied                  | Use Knowledge Base; request minimum-role review for the operational route               |
| Loading skeleton remains       | Check connection, wait once, refresh, then capture route/time/role                      |
| Validation prevents submit     | Correct every labeled field and required evidence; do not bypass the gate               |
| Possible duplicate transaction | Refresh and search the record before retrying                                           |
| Stale-state message            | Reload the current record and re-evaluate before acting                                 |
| Vendor invitation not received | Legal checks delivery status and contact address before retrying                        |
| Receipt variance or damage     | Use inspection/hold/vendor-return workflow with evidence                                |
| Mobile control is obscured     | Scroll into the reserved safe area; report viewport and screenshot if still unreachable |

Support evidence should contain route, time, role, safe record ID, expected outcome, visible error, and a redacted screenshot. Never include credentials or private document contents.

## Security and Data Handling

- Use individual accounts; never share QA or production passwords.
- Grant minimum scoped roles.
- Treat access denied as a control, not an obstacle to bypass.
- Keep evidence and decisions in the governed workflow.
- Verify saved state before retrying writes.
- Rotate any credential exposed in chat, logs, screenshots, or documentation.

## Glossary

- **DOA:** Delegation of Authority approval matrix.
- **PR:** Purchase request.
- **PO:** Purchase order.
- **Putaway:** controlled movement of accepted stock into a valid bin.
- **Cycle count:** physical count used to govern stock variance.
- **Idempotency:** duplicate-effect prevention for retried commands.
- **RLS:** database row-level security.

## Future Recommended Features

All items below are **proposed**, not current capabilities:

1. Admin article drafting, approval, effective dating, and version history.
2. Contextual help launched from operational controls.
3. Search analytics and unsuccessful-query reporting.
4. Article feedback and correction requests.
5. Policy-to-procedure traceability.
6. Guided sandbox walkthroughs.
7. Multilingual governed documentation.
8. Offline Knowledge Base precaching.
9. Role onboarding curricula and completion tracking.
10. Workflow-linked release notes.

## Documentation Assets

The standalone searchable handbook is `docs/manual/index.html`.

![Knowledge Base desktop flow](assets/knowledge-base/employee-desktop.png)

![Knowledge Base vendor mobile](assets/knowledge-base/vendor-mobile.png)

![Knowledge Base narrow mobile](assets/knowledge-base/employee-narrow.png)

### Audited Interactive Flows

The live flowcharts show the accountable role before every action, the governed
sequence through the center lane, and success or exception outcomes beside the
step that produces them. Select any process node to open its prerequisite,
owner, expected result, and recovery path.

![Procure-to-pay flowchart on desktop](assets/knowledge-base/flowchart-procure-to-pay-desktop.png)

![Receive-to-putaway flowchart on narrow mobile](assets/knowledge-base/flowchart-receive-to-putaway-mobile.png)

Procedure articles include current screen guides from the live application.
Warehouse configuration and receiving guides use successful screens only; older
screens marked as errors remain historical audit evidence and are not training
instructions.

Historical screenshots remain in `docs/manual/assets/`; screenshots showing retired blockers are evidence only and must not be used as current training guidance.
