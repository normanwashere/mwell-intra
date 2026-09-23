# Private Reporting Authority Foundation

Status: inactive database foundation, not a reporting service or an activation approval.
Candidate: `supabase/migrations/20260923025605_reporting_private_authority_foundation.sql`.
Created with installed Supabase CLI 2.113.0 `migration new`, after reading command help.

This implements only the authority portion of the [reporting design](../../superpowers/specs/2026-09-20-reporting-api-design.md)
and the current-grant shape consumed by `apps/shell/lib/reporting/auth.ts`.
No live migration, deployment, account provisioning, commit or push was performed for this work.

## Scope

- Private `reporting_authority` schema; four initially empty tables: `principals`, `current_grants`, `denied_clients`, `admin_audit`.
- Immutable issuer/client/environment registrations, generated UUID principal IDs, initially inactive.
- Exactly one explicit current grant per principal: 1-30 distinct catalogue dataset IDs, 1-100 distinct opaque consumer IDs, explicit opaque bundle version, generated scope/disclosure UUID epochs.
- A database CHECK constraint enumerates the exact 30 IDs from `catalog.ts`; it does not establish source availability, field disclosure, dependency closure, or an approved bundle.
- Permanent compromise denial of an exact issuer/client pair across every environment, including identities not registered yet.
- Append-only successful-administration audit with actual PostgreSQL `session_user`, timestamp, opaque change/ticket reference and authority metadata. No tokens, keys or credentials are stored.
- One scalar current-grant lookup. No list/search/export reader, arbitrary SQL, source joins or operational calls.

Shared quotas, leases, rate limiting, captures, projections, source permissions, source disclosure interlocks,
snapshot storage, retention, API endpoints, token issuance, managed-provider setup and application DB adapters
are explicitly out of scope. There are no default live principals/grants, login accounts, passwords, or shared
service-role credentials. Installing this migration cannot start data extraction or enable a reporting route.

## Roles And Trust

| Role | Authority capability |
| --- | --- |
| `reporting_authority_owner` | NOLOGIN schema/table/function owner; never assigned to the app |
| `reporting_authority_reader` | Schema USAGE; EXECUTE only on `read_current_grant(text,text,text)` |
| `reporting_authority_admin` | Schema USAGE; EXECUTE only on the five fixed administrative functions below |
| `PUBLIC`, `anon`, `authenticated`, `service_role` | No authority schema, table, or function access, including service-role BYPASSRLS |

All three new roles are NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEROLE, NOCREATEDB, NOREPLICATION,
NOBYPASSRLS. They are not members of operational/app roles. No app login or `authenticator` is granted membership.
There is no direct reader/admin table DML, schema CREATE, ownership, role administration, or audit-table reader.
Each function has an explicit signature-level revoke/grant and fixed `search_path = pg_catalog, pg_temp`.
All application objects are schema-qualified. RLS is enabled without caller policies; only owner-executed
functions bypass it. New owner default privileges do not inherit the installer's default service-role grants.

Installation supports a non-superuser CREATEROLE database owner. The migration temporarily grants its
installer SET access to the new owner so objects are created as that owner, then removes that temporary grant.
It locally clears `createrole_self_grant` before creating roles. **PG17 automatically retains bootstrap-granted
ADMIN OPTION memberships for a non-superuser creator, with SET=false and INHERIT=false.** A non-superuser
creator cannot remove those bootstrap grants; an actual superuser can. Tests verify precisely these three
creator-only memberships, no usable SET/INHERIT membership, and no app memberships.

Consequently the database superuser, managed database/platform administrators, and the CREATEROLE migration
operator are trust roots. The operator can grant itself owner access again. Owners/superusers can disable
triggers, change ACLs or alter stored authority. This foundation does not claim immutable state against those
administrators, the database host, backups, or a malicious platform operator. PostgreSQL explains these
[automatic creator grants](https://www.postgresql.org/docs/17/role-attributes.html).

## Fixed Administration

The following are SQL functions, not exposed PostgREST RPCs. All parameters shown without a type are text.
All successful calls append an audit event in the same transaction; an audit failure rolls the mutation back.
The delegated admin manages reporting metadata across environments, not operational application permissions.

| Function | Behavior |
| --- | --- |
| `register_principal(issuer, client, environment, change_ref) -> uuid` | Create a new inactive identity; duplicate identities and denied clients fail |
| `set_grant(id uuid, datasets text[], consumers text[], bundle, change_ref) -> void` | Replace explicit grant sets, validate before sorting, reject denied/missing principal |
| `set_active(id uuid, enabled boolean, change_ref) -> void` | Enable only with a valid grant and no permanent deny, or suspend |
| `rotate_disclosure(id uuid, change_ref) -> void` | Generate a new disclosure epoch for an existing grant |
| `deny_client(issuer, client, change_ref) -> void` | Permanently register compromise, suspend all environments, rotate both epochs; repeated denial is audited but does not erase/replace the first deny |

Opaque identifiers/references match `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`. Client identity is 1-256 printable ASCII
characters. Issuer is an exact-match, bounded (2048-character) conservative HTTPS DNS-host/path subset:
no ports, userinfo, query, fragment, whitespace, non-ASCII or backslashes. This deliberately accepts fewer URLs
than the application verifier. Operator-approved provider issuers must satisfy both; do not normalize tokens'
issuer strings or rewrite registrations to circumvent a mismatch. No function performs issuer discovery or fetching.

Scope changes (dataset set, consumer set, bundle version, suspension/reactivation) generate a new scope epoch.
Set order and unchanged values do not invalidate state. Disclosure rotation is independent; compromise rotates
both. Routine provider key rotation with unchanged identity/grants needs no database mutation and preserves epochs.
Compromise requires a new OAuth client identity, not re-enabling the old one after a key change. Epochs are not
token revocation by themselves; the existing verifier must consult the current identity/deny on every request.

Identity update/delete/truncate, grant deletion/truncate, and deny/audit update/delete/truncate are blocked by
triggers as well as ACLs. Principal inserts and activation check the permanent deny registry. Direct deny insertion
also suspends existing registrations through a trigger. The tests temporarily grant delegated DML plus RLS policies
inside a rolled-back transaction to demonstrate that the immutability triggers themselves reject bypass attempts.
They do not grant ownership or permission to disable triggers.

Administration serializes on `principals` with a private SHARE ROW EXCLUSIVE table lock. This intentionally
simple, low-volume control-plane lock fences absent-identity registration against compromise as well as changes
to existing principals. Reader SELECTs remain compatible; no operational/source table is read or locked.
Failed/rolled-back admin attempts are **not durable audit events**: PostgreSQL rolls their audit rows back too.
Future control-plane infrastructure must separately log denied attempts without secrets. There is no SQL audit
pruning API, restore workflow, or tamper-evident external audit archive here.

## Reader Contract

`read_current_grant(issuer text, client text, environment text) -> jsonb` returns NULL for unknown/ungranted
identities or one bounded object matching `auth.ts`:

```text
principal_id, issuer, client_id, environment, active, permanently_denied,
scope_epoch, disclosure_epoch, bundle_version, dataset_ids, consumer_ids
```

The reader may look up any exact identity; it is a trusted backend authority adapter capability, not an OAuth
client credential and not a tenant-isolated SQL login. It cannot enumerate via a supplied SQL expression.
Disabled/denied identities with a grant return a valid shape with denying flags, so the verifier fails closed.
The function is VOLATILE and rejects repeatable-read/serializable transactions. Admin functions reject those
isolation modes too. Use fresh READ COMMITTED calls, no positive authorization cache, parameterized SQL, and
the verifier's cancellation/timeout. The lookup observes state committed at its statement snapshot; it cannot
retroactively cancel an already authorized in-flight action. Broader request/publication/disclosure fencing is
not implemented. No adapter, connection pool, login role or credentials are provisioned in this change.

## Operational Isolation Limit

**Private authority isolation is proven; database-wide reporting-role isolation is not.** PostgreSQL combines
direct, inherited and PUBLIC privileges. NOINHERIT and absence of explicit operational grants do not subtract
PUBLIC EXECUTE or PUBLIC schema USAGE. See PostgreSQL's [REVOKE behavior](https://www.postgresql.org/docs/17/sql-revoke.html).

The real-PG fixture installs the repository's actual final-DOA decision, activation and eligibility functions
with synthetic operational/auth dependencies. Reader/admin calls to those RPCs and raw procurement tables
fail with `42501`; their bodies, ACLs and operational records stay unchanged. This is a focused fixture, **not**
a replay of all migrations or an audit of the live database's complete effective ACLs.

A synthetic SECURITY DEFINER operational canary deliberately left PUBLIC-executable in usable `public` is
successfully invoked by the reader inside a rolled-back transaction. Its restricted counterpart is denied.
That positive negative-control demonstrates exactly why this migration cannot certify that a reporting SQL
login cannot invoke every operational function. It does not imply that the synthetic canary exists in UAT.
No existing operational permission is revoked globally to make a test pass.

**Do not activate/provision reporting logins or memberships until a full effective operational ACL audit and
approved isolation design resolve this boundary.** Review every accessible SECURITY DEFINER function and its
transitive calls, all usable schemas, PUBLIC/default privileges, table privileges, RLS and role memberships.
Remediation may require separately approved operational ACL changes or a separated execution boundary.

## Inactive UAT Installation

Candidate is suitable for **inactive installation after independent review and target preflight**, not activation.
Tests install unchanged SQL on native PG17.10 as a non-superuser CREATEROLE database owner with deliberately
broad installer default privileges and self-grant settings. The upstream UAT preflight reports PG17.6, CREATEROLE
without SUPERUSER, and no existing reporting roles/schema. This work did not independently connect to UAT.
Managed Supabase-specific event triggers and platform restrictions are not emulated by native PostgreSQL.

Final upstream preflight reported by the deployment owner on September 23: `authenticator` explicitly exposes
`public,core,warehouse,procurement,legal,product,learning,graphql_public`, excluding `reporting_authority`.
Operational metadata fingerprints were recorded by that owner. These are upstream read-only findings, not a
claim that this authority task queried or wrote UAT. Independent Pasteur review reported no P0/P1/P2 findings.
SQL and test edits are frozen for the independently reviewed inactive installation; the main deployment owner
retains responsibility for applying and verifying the migration. Activation remains blocked as described above.

Before applying via the main deployment owner's approved migration workflow:

1. Confirm intended project/database, PG17, installer CREATE-on-database/CREATEROLE/role-admin ability, and absence of the three role names and `reporting_authority` schema. Roles are cluster-global. Collisions fail closed; do not silently adopt an existing role.
2. Inspect `pg_db_role_setting` for database, role and database+role settings, including `authenticator`, plus the effective Supabase/PostgREST exposed-schema configuration. `current_setting('pgrst.db_schemas', true) IS NULL` in an admin connection is **not proof** of the API configuration. Keep `reporting_authority` out of exposed schemas. This migration makes no configuration changes.
3. Independently review the SQL, tests, expected installer-only ADMIN memberships, and the PUBLIC RPC activation blocker above. Do not supply a reporting credential or application membership as part of installation.
4. After installation, verify all four tables are empty; owner/schema/function ACLs and RLS; only the reader's one function and admin's five functions are delegated; no app role memberships; no operational ACL/body/data changes; effective exposed schemas still exclude authority.

Useful read-only exposed-schema inventory (absence of rows still requires checking the external service configuration):

```sql
select d.datname, r.rolname, v.setting
from pg_db_role_setting s
left join pg_database d on d.oid = s.setdatabase
left join pg_roles r on r.oid = s.setrole
cross join lateral unnest(s.setconfig) as v(setting)
where v.setting like 'pgrst.db_schemas=%'
   or v.setting like 'pgrst.db_extra_search_path=%';
```

Do not return entire `setconfig` arrays or wildcard `pgrst.*` entries: the same array may contain JWT/secret settings.

There is no destructive down migration or automatic cleanup of live authority records. Install failures within
the SQL transaction roll back; do not retry over unexplained partial state. Database restore can restore old
grants/denies/audit, so deny-registry reconciliation and epoch invalidation must be designed before activation.

## Verification Commands

Use the existing workspace `pg` dev dependency and Node 24. No dependency installation is performed by these tests.
Run from the full-app worktree root. Exact CI command, sequentially **after** the prior DOA native harness:

```sh
node --test scripts/reporting/verify-authority.postgres.test.mjs
```

Required shared CI environment:

```text
CI=true
SEP22_DOA_EPHEMERAL_CI=1
SEP22_DOA_CI_DATABASE_URL=postgresql://postgres:<disposable-password>@127.0.0.1:<port>/postgres
POSTGRES_INITDB_ARGS=--set=cluster_name=sep22_doa_ci
```

The guard requires numeric loopback, `/postgres`, user `postgres`, PG17 and the marker. It rejects URL query
overrides, other databases, custom maintenance schemas/objects, unexpected roles and custom memberships.
It allows only validated NOLOGIN `anon`, `authenticated`, `service_role` left by the prior harness, plus standard
PostgreSQL built-ins. It creates one random `reporting_authority_<32 hex>` database and known fixture/authority
roles only after validating absence. Cleanup closes its connections, drops only its named database and its new
roles, and leaves the prior harness's API roles untouched. The shared service must not run these suites concurrently.

Local native mode uses `SEP22_DOA_PG_BIN` instead of the CI variables. The existing native scratch harness
creates a new loopback-only cluster with random credentials and stops it after the tests; it retains only synthetic
temporary files/logs for diagnosis. Neither mode reads `.env`, `DATABASE_URL`, Supabase project links or live credentials.
Without either mode, the main native test explicitly skips; the separately owned release-contract/CI gate must
require the configured native execution and zero skips.

Optional full local sequential-CI proof, with `SEP22_DOA_PG_BIN` set:

```sh
node --test scripts/reporting/verify-authority-ci-sequence.postgres.test.mjs
```

This starts a fresh marked PG17 service, runs the actual prior DOA test, runs the new authority suite twice,
asserts zero skips and no remaining custom database/authority roles after each pass, then stops the service.

RED evidence: with the CLI-created empty migration the native suite failed `Migration must install the private
reporting authority`. Native checks cover effective negative ACLs including service-role BYPASSRLS, exact
30-ID constraints, lifecycle/epoch changes, permanent denial, append-only triggers, audit rollback, hostile
search_path, stale-transaction rejection, and observed independent-backend lock waits during compromise races.
These are scoped security proofs, not penetration testing, capacity measurements, full Supabase stack testing,
or a guarantee about unchanged live settings.

## Final Evidence Ledger

Recorded September 23, 2026. SQL/test files frozen after the passing runs below.

Migration SHA-256:

```text
8bbc47627fbfb4dcd2f97ce0f3efdfbd73ab066d6835bf12f4ffc158378b6d98
```

| Verification | Observed result |
| --- | --- |
| Empty-migration RED run | Intended missing-authority assertion failed on real PG17 |
| Direct native authority suite | 17/17 passed, zero skipped; PG17.10; non-superuser CREATEROLE database-owner installation |
| Exact guarded CI sequence | Existing DOA 16/16, authority 17/17, authority rerun 17/17; zero skipped; cleanup verified after each; service stopped |
| Schema-settings documentation query | Synthetic JWT secret in a sibling setting was not returned; only the two schema settings returned |
| Broad `pnpm test` attempt | Not green: Events timeouts and Finance/Onboarding failures appeared before Turbo stopped |
| Isolated reruns without source changes | Events `EventsApp.evidence.test.tsx` + `EventsApp.test.tsx`: 16/16; Finance `populationAcceptance.test.ts`: 1/1; Learning `OnboardingTrainingSession.test.tsx`: 8/8, all with one worker |
| Upstream independent Pasteur report | No P0/P1/P2; 174 reporting + 4 release-contract tests; native 17/17 twice sequentially with DOA (reported by main, not rerun as part of this task) |

The full-workspace concurrent failure is not represented as a passing full suite merely because its failing
files passed individually. Existing Tailwind/React test warnings were observed; no unrelated remediation was made.

Owned deliverables only:

- `supabase/migrations/20260923025605_reporting_private_authority_foundation.sql`
- `scripts/reporting/verify-authority.postgres.test.mjs`
- `scripts/reporting/authority-test-runtime.mjs`
- `scripts/reporting/verify-authority-ci-sequence.postgres.test.mjs`
- `docs/integrations/reporting-api/AUTHORITY-FOUNDATION.md`

No dependency/package/lockfile, CI YAML, release-contract test, dictionary, application auth or shared
deployment documentation edits were made by the authority implementation subtask. Its local tests made no
live database writes. The coordinating release subsequently installed the exact reviewed SQL as recorded below.

## UAT Installation Record

Installed on September 23, 2026 at approximately 03:20 UTC, in UAT project `kkoitlvydytdhlpxhuah` only.
The managed migration service recorded version `20260923032017` and name
`reporting_private_authority_foundation`. Its SQL is the exact source migration
`20260923025605_reporting_private_authority_foundation.sql` with the SHA-256 above. These differing
version identifiers are an explicit source-to-install mapping, not permission to replay or renumber migrations.

Post-install read-only verification confirmed:

- All four authority tables contain zero rows. No client, grant, deny entry or audit event was seeded.
- All three authority roles are NOLOGIN, NOINHERIT and have no superuser, CREATEROLE, CREATEDB,
  replication or BYPASSRLS privileges. Only the managed `postgres` creator retains ADMIN memberships;
  their SET and INHERIT options are false. The managed administrator remains a trusted operator.
- `anon`, `authenticated`, `authenticator` and `service_role` have no schema USAGE. No application
  role received authority membership. PostgREST's exposed-schema list excludes `reporting_authority`.
- All four tables are RLS-enabled and owned by `reporting_authority_owner`, with owner-only table ACLs.
  The reader can execute only `read_current_grant`; the admin has only the five documented admin functions.
  Internal helpers have owner-only EXECUTE. All functions use `pg_catalog, pg_temp` as their fixed search path.
- Before/after metadata fingerprints matched across 583 existing functions, 965 existing relations and
  316 existing RLS policies in the operational schemas. This checks their definitions/ownership/ACL and
  RLS metadata, not a business-row comparison. No operational DML is present in this migration.

The authority remains empty and disconnected. No reporting HTTP route, database login, runtime membership,
issuer integration, export worker, connector or dataset access was enabled. The PUBLIC operational-RPC
boundary and other activation gates above remain unresolved. Production was not changed.

Implementation references: [Supabase database functions](https://supabase.com/docs/guides/database/functions),
[PG17 SECURITY DEFINER precautions](https://www.postgresql.org/docs/17/sql-createfunction.html).
The [Supabase changelog](https://supabase.com/changelog) was checked; no extension, API exposure or runtime
upgrade is part of this migration.
