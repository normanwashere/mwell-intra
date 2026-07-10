# Mwell Intra Launch Traceability Matrix

This matrix is the release source of truth for roadmap items that were not fully evidenced by the application audit. A row is launch-ready only when implementation, automated evidence, business UAT, and named ownership are all complete.

| Roadmap ID | Launch requirement | Implementation or control | Automated evidence | Business evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F-013 | Bulk master-data migration/import | Versioned CSV contracts in `docs/import-templates`; cutover dry-run and reconciliation procedure | Import header validator in release checklist; database count/checksum reconciliation | Signed dry-run reconciliation | Data migration lead | Process-ready; execution pending |
| F-029 | Legal accreditation summary export | `caseSummary.ts`; reviewer/approver action on Legal case detail | `caseSummary.test.ts` | Legal confirms fields and retention handling | Legal operations | Code-complete; UAT pending |
| F-086 | Data migration and cutover | `MIGRATION_CUTOVER_HYPERCARE_RUNBOOK.md`; immutable migration sequence; rollback criteria | `verify:supabase-cutover`; migration compile checks | Go/no-go record and reconciliation sign-off | Release manager | Process-ready; production run pending |
| F-087 | Standardized import templates | Versioned templates and contract README under `docs/import-templates` | Header/schema validation in preflight | Data owners approve mappings | Data migration lead | Complete; owner approval pending |
| F-100 | Role-based training and operations handoff | `USER_TRAINING_AND_OPERATIONS_MANUAL.md` | UAT attendance/evidence checklist | Attendance and competency record | Change manager | Process-ready; delivery pending |
| F-101 | UAT and issue management | `UAT_AND_ISSUE_MANAGEMENT.md`; severity, SLA, retest, waiver and sign-off rules | CI, live role crawler, issue evidence links | UAT sign-off and open-risk acceptance | Product owner | Process-ready; execution pending |

## Evidence Rules

- `Code-complete` means merged code has focused tests, typecheck, lint, build, and rendered responsive evidence.
- `Process-ready` means the template and approval path exist; it does not imply the business activity happened.
- A screenshot alone does not prove persistence. Mutation evidence must include the created record ID and an independent database read-back.
- A waiver must identify the residual risk, compensating control, owner, expiry date, and executive approver.
- Production launch requires zero open P0/P1 defects and explicit disposition of every P2.

## External Decisions

| Decision | Required owner | Due before |
| --- | --- | --- |
| Final ERP/courier/payment integration scope beyond CSV handoff | Executive sponsor and enterprise architecture | Post-MVP planning |
| Retention periods for vendor documents and generated exports | Legal, Privacy, Information Security | Production data load |
| Named on-call and escalation contacts | Operations and Engineering | Go/no-go meeting |
| Production Supabase secret key and invitation sender configuration | Platform owner | Vendor invite UAT |
