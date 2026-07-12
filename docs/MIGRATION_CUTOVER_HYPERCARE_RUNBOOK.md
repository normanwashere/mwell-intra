# Migration, Cutover And Hypercare Runbook

Policy-aligned Legal, vendor accreditation, Procurement, PO, Warehouse acceptance, and Finance payment controls additionally follow [the policy alignment cutover runbook](runbooks/POLICY-ALIGNMENT-CUTOVER.md). That runbook is authoritative for signed-evidence immutability, active DOA loading, open-record remediation, and policy-specific go/no-go gates.

## Ownership

Name the release manager, database operator, application deployer, data migration lead, Security approver, Legal approver, Finance/Warehouse reconciler, business UAT lead, and incident commander before scheduling cutover. A role without a named person is a no-go condition.

## Preflight

- Freeze schema and master-data changes; record the release commit and Vercel deployment candidate.
- Back up/export source data and record row counts and SHA-256 checksums.
- Validate every CSV against `docs/import-templates/README.md`; quarantine invalid rows instead of coercing them.
- Run unit tests, lint, typecheck, production build, procurement contract verifier, Supabase cutover verifier, and three responsive role crawls.
- Dry-run migrations in order against a production-equivalent database and review Supabase security/performance advisors.
- Confirm private buckets, RLS denial tests, invitation secret, HTTPS `APP_URL`, monitoring, support roster, and rollback authority.
- Provision nine dedicated Warehouse W1 users with exactly one scoped role each; never reuse a universal admin identity for route or mutation evidence.
- Run `test:warehouse-w1`, `test:warehouse-w1:visual -- --repeat-each=3`, `test:warehouse-w1:performance`, schema/contract verifiers and the contact-sheet review before go/no-go.

## Cutover Sequence

1. Announce change window and place source processes in read-only/frozen state.
2. Capture final source counts/checksums and backup restore reference.
3. Apply reviewed migrations in timestamp order. Record migration versions and operator.
4. Import reference data in dependency order: users/roles, locations, bins, vendors, products, opening stock.
5. Reconcile accepted, rejected, duplicate, and transformed rows to the source total.
6. Deploy the exact approved application commit and verify `/api/health` plus static assets.
7. Run authentication, authorization denial, private file, approval progression, warehouse write/read-back, export, and vendor invitation canaries.
8. Business owners execute the launch-smoke journeys and sign go/no-go.
9. Remove the freeze only after the release manager records the decision.

## Reconciliation

For each entity record source count, accepted count, rejected count, duplicate count, target count, source checksum, target extract checksum, variance reason, owner, and sign-off. The equation `source = accepted + rejected + duplicates` and `target delta = accepted` must hold. Inventory additionally reconciles quantity and serialized-unit counts by product and location.

## Rollback Triggers

Rollback for cross-user data access, incorrect approval authorization, unrecoverable authentication, data corruption, inventory imbalance without understood variance, sustained core-path error rate, or failed migration with no tested forward fix. The incident commander may stop launch; only the release manager may resume.

Rollback order: freeze writes, route users to maintenance, preserve logs/record IDs, roll back application deployment, restore database only under the tested restore plan, verify integrity and auth, communicate status. Never run an improvised destructive SQL rollback.

Warehouse-specific stop conditions are any negative balance, duplicate movement or receipt, serialized unit in two locations/states, unauthorized/self-approved stock change, unreconciled import total, lost immutable audit evidence, or p95 floor confirmation above the approved threshold for two consecutive windows.

## Hypercare

For the first 72 hours, staff 08:00-20:00 Asia/Singapore coverage with an after-hours P0 contact. Review health, auth/storage/API logs, failed invites, error correlation IDs, approval aging, request/PO progression, inventory variances, export jobs, and unresolved user reports at least every four hours. Publish a daily summary of volumes, failures, open defects, decisions, and owners.

Exit hypercare after two consecutive business days with no P0/P1, reconciliations signed, support queue within SLA, no unexplained error trend, and module owners approving handoff to normal operations.

Track Warehouse hypercare at least every four hours: receipts and receipt failures, quality hold age, putaway backlog, transfer deviations, count variance value/age, approval SLA, exception severity/age, import rejection rate, command conflicts, negative-balance invariant, duplicate/idempotency invariant, route p95 and client error rate. Record owner and corrective action for every threshold breach.
