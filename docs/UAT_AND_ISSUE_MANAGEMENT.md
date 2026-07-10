# UAT And Issue Management

## Entry Criteria

- Release candidate commit is immutable and deployed to the UAT environment.
- Database migrations and environment preflight pass.
- Test identities exist for every role without sharing personal accounts.
- Seeded test data is tagged and isolated from production reporting.
- Desktop 1440x900 and mobile 390x844 are tested; 320px width receives a layout smoke test.

## Required Role Journeys

| Role | Required journey and negative case |
| --- | --- |
| Core staff | Sign in, open permitted modules, sign out; direct-navigation denial for an unassigned module |
| Platform admin | Assign and remove scoped roles, verify next-session effect; reject self-lockout and invalid role combinations |
| Vendor | Accept invitation, set password, complete profile, upload/replace evidence, sign instruments, submit; block another vendor's case |
| Legal reviewer | Invite vendor, review each evidence state, request correction, export summary; reject incomplete approval |
| Legal compliance/approver | Approve/provisionally approve/reject with signature; verify expiry and renewal path |
| Procurement requester | Create draft with line items and private attachment, submit, observe progress; reject invalid amount/date/file |
| Procurement officer | Review request, source/award, author purchase order; block skipped approval tiers |
| Procurement approver/finance | Approve, reject, return with note; verify threshold routing and separation of duties |
| Warehouse logistics | Create location/bin, receive serialized and bulk stock, receive against PO; reject duplicate serial and invalid bin |
| Warehouse operations/marketing | Create event, reserve, issue, return, cancel; reject over-allocation and unauthorized issue |
| Warehouse finance/BI/pricing | Reconcile, cycle count, governed export/review, pricing; deny export to unauthorized roles |

Each successful mutation records: timestamp, role, input ID, resulting record ID, visible confirmation, database read-back, and cleanup/disposition.

## Defect Severity And SLA

| Severity | Definition | Triage | Target disposition | Launch rule |
| --- | --- | --- | --- | --- |
| P0 | Security breach, data loss/corruption, cross-tenant access, system unavailable | 15 minutes | Contain immediately | Stop test and launch |
| P1 | Core workflow blocked, incorrect approval/financial state, persistent blank page | 1 hour | Fix within 1 business day | Must be closed |
| P2 | Significant UX/accessibility defect with workaround | 1 business day | Fix or approved time-bound waiver | Explicit disposition |
| P3 | Minor polish or low-impact copy issue | 2 business days | Backlog with owner | May launch |

## Issue Record

Every issue must contain environment, commit, account role, viewport, preconditions, exact steps, expected/actual result, record IDs, console/network evidence with secrets removed, severity rationale, owner, target date, and regression scope.

## Retest And Sign-Off

1. Engineer attaches focused automated evidence and identifies the affected contract.
2. A tester other than the implementer retests the original path, negative case, adjacent role, and both viewports.
3. Product owner closes functional issues; Security closes security issues; Legal/Finance close policy issues in their domains.
4. UAT sign-off lists executed cases, failures, waivers, residual risks, release commit, deployment ID, and approvers.

Waivers expire within 30 days unless the executive sponsor records a shorter date. P0/P1 defects cannot be waived for production launch.
