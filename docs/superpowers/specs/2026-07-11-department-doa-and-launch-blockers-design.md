# Department DOA and Launch Blockers

## Decision

Mwell Intra will maintain one effective Delegation of Authority matrix for each department. Platform Administrators and Legal Administrators may create, revise, validate, and activate a department matrix. Configuration access does not grant approval authority: only the named user assigned to a derived approval step may act on that step.

## Data and authorization

- Each matrix is department-scoped, versioned, effective-dated, and immutable after activation.
- A new `legal:manage_doa` capability is granted only to the Legal Admin role. Platform Administrators qualify through `core:manage_rbac`.
- Writes use private `security definer` functions exposed through narrow procurement RPC wrappers. Direct table writes remain revoked.
- Activation validates non-overlapping amount bands, one matching named approver per required tier, active employee profiles, and exactly one final approver for each configured band.
- Activating a revision retires the prior matrix for the same department in the same transaction and records an audit event.
- Procurement submission must use an active matrix whose department exactly matches the request. There is no silent global fallback.

## Admin experience

The shell hosts a responsive `/admin/doa` workspace available to Platform and Legal Administrators. It lists department coverage and matrix state, supports draft creation and assignment editing, shows validation errors inline, and requires an explicit activation confirmation. Desktop uses a dense table/editor layout; mobile uses stacked assignment rows with reachable actions and no horizontal dependency.

## Remaining launch controls

Database changes remediate safe, mechanically verifiable advisor findings such as missing foreign-key indexes and auth helper init-plan warnings. Dashboard-only controls, including leaked-password protection, connection strategy, and exposed key rotation, are represented by a failing production-readiness check until verified outside SQL. Unused-index advisories are not resolved by blind deletion because usage statistics are workload-dependent.

## Verification

Unit and browser tests cover Platform Admin access, Legal Admin access, denial for other roles, department-specific selection, missing-matrix failure, duplicate/overlapping assignment rejection, activation history, desktop layout, and mobile layout. Database migrations are transaction dry-run before application, followed by Supabase advisors and the full repository quality gates.
