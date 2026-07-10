# Policy Alignment Cutover

## Release Preconditions

- Legal approves the clean Vendor Accreditation Form v.2025 master and governed Technology Service Provider MNDA master.
- Procurement and Finance approve and load one active DOA matrix with one named approver for every required tier and exactly one final approver for every applicable range.
- The migration passes a transaction-wrapped compile against the designated Supabase test project.
- Security and performance advisors have no unresolved release-blocking findings.
- Persona E2E, denial tests, persistence read-back, and three visual crawls are green with zero P0/P1 defects.

## Open-Record Review

1. Export open Legal and Procurement records to the migration input contract.
2. Run `node scripts/migrate-policy-review-records.mjs --input <records.json> --run-id <change-id>`.
3. Review totals by mismatch reason. Completed signed evidence must appear only under `preserved`.
4. Assign every queued record to Legal, Procurement, or Finance. Do not rewrite signed snapshots, executed instruments, approvals, receipts, or released payment evidence.
5. Apply only to a designated test project with `--apply --test-project <ref>` and matching `POLICY_REMEDIATION_TEST_PROJECT`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` environment values.

## Freeze And Go/No-Go

- Freeze policy templates, role assignments, DOA configuration, vendor dispositions, and procurement approvals during cutover.
- No-go if the active DOA matrix is missing, ambiguous, expired, or has duplicate/missing tier assignments.
- No-go if any vendor can read another vendor's files, requester can self-confirm a route, Platform Admin gains department approval authority, or Finance can accept an incomplete pack.
- No-go if production and test project references cannot be positively distinguished.

## Deployment Order

1. Back up governed schemas and record migration versions.
2. Apply the database migration through the migration system.
3. Load approved policy definitions and the active DOA matrix through controlled administration.
4. Deploy the app with production demo mode disabled.
5. Run authenticated canaries and fresh-session read-back for every role.
6. Release the freeze only after Legal, Procurement, Finance, Warehouse, Security, and Product sign off.

## Rollback

- Stop new submissions and approvals; do not delete transactions created after cutover.
- Roll back the app to the prior verified deployment.
- Use a forward corrective migration for database defects. Do not down-migrate signed evidence or audit history.
- Mark affected open records `policy_review_required` and preserve their run ID and prior version.

## Hypercare

- For five business days, review auth failures, denied RPCs, RLS errors, route/DOA blockers, accreditation exceptions, receipt mismatches, and returned payment packs twice daily.
- Owners: Legal for accreditation/instruments; Procurement for routing/sourcing/award; Finance for DOA/payment; Warehouse for custody/quality; Platform for auth/RLS/availability.
