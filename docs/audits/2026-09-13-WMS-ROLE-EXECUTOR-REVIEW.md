# Isolated WMS Role Setup Review

Status: offline implementation and independent review complete; no new live accounts or grants have been created by this executor. This is test infrastructure, not warehouse role certification or a human approval.

## Scope

The reviewed planner adds six single-role accounts and one operator/supervisor combination without changing the existing tester roster. Each receives only the reviewed `core.staff` baseline, its exact warehouse roles and the declared department membership. Auth creation uses the admin API; core rows use plain inserts in one database transaction. There is no existing-account reconciliation, upsert, automatic deletion or learning/certification write.

## Issues Found And Fixed

| Finding | Correction | Verification |
| --- | --- | --- |
| Approval could expire during awaited preparation, yet the next write still ran. | Check expiry immediately before Auth creation, core insertion and COMMIT, after awaited preparation/journal writes. Preserve uncertain-outcome reporting only when a write was actually attempted. | Three failing tests reproduced late creation/insertion/commit, then passed after the fix. |
| Correct scoped role metadata could conceal an unexpected top-level Auth role. | Explicitly request `authenticated` and require that exact role on the creation response and every later Auth readback. Retain a returned UUID before rejecting the response. | Missing, anonymous, service-role and custom-role responses, plus later role elevation, are rejected before core insertion. This was an injected response test, not a finding that UAT normally creates privileged users. |
| Tests required ignored local audit output files. | Commit schema-only catalog definitions and generate synthetic identities/readbacks in tests. The CLI prepare test uses a temporary synthetic directory. | A subprocess makes ignored output reads fail and reruns the executor tests successfully. No existing-user data or credentials were copied into the fixture. |

## Checks

Parent and independent reviewer each ran **71 passing tests, zero skips**: 46 executor regressions, 24 planner regressions and the output-unavailability test. The latter reruns executor checks in a subprocess; it does not represent additional live scenarios. Syntax checking also passed.

The local PostgreSQL-compatible harness checks plain inserts, conflict rollback and the reviewed active-profile trigger. The in-memory adapters check ambiguous Auth outcomes, durable intent/UUID recording, repeated/concurrent invocation, target/build/catalog drift, protected-roster changes and postcommit failures. They do not prove actual network transport or user-session permissions.

Reviewed source hashes before any commit line-ending normalization:

| File | SHA-256 |
| --- | --- |
| `scripts/qa/wms-role-provision-live.mjs` | `83ac2046d7695d68fed3806da736836128d613bfa880144a8d59e3493ca501a0` |
| `scripts/qa/wms-role-provision-live.test.mjs` | `f0fc68258a584b490fcee4ea263f35a73c4b8373fde58a9b44f3802d44dec259` |
| `scripts/qa/wms-role-provision-clean-checkout.test.mjs` | `9240203f9c9f635898496684de6296a963829c8a95f111120f1bdec0d335f755` |
| `scripts/qa/fixtures/wms-role-identity-catalog.json` | `8b954418ae85b4b6db3115731fa6c5dd41d8862f55bd4144b9427d85d42a080d` |

The fixture contains exactly 44 column definitions, 35 constraints and four trigger definitions from the retained catalog projection. Its synthetic identity data is generated separately, not copied from existing testers.

## Before Live Execution

1. Confirm the exact UAT build and database target, current catalog, namespace absence, and protected tester readbacks. Reissue a reviewed, hash-bound, time-limited approval for the final source revision. The generated template remains unapproved.
2. Establish the stated namespace ownership and DDL coordination. The local marker only prevents replay from the same directory; it is not a global lock or a claim that all UAT writers are stopped.
3. Verify actual database/pooler connectivity and session behavior with read-only checks. Supply credentials only through the approved ephemeral execution environment, not this document or chat.
4. Create only the seven approved synthetic identities. On an ambiguous Auth or commit outcome, retain the attempt journal and inspect current state; do not retry or delete blindly. Auth creation and the core transaction are not atomic together.
5. Independently requery new assignments, then sign in normally and complete required governed onboarding. Verify ordinary-session capabilities, allowed operations, denied mutations and record scopes. Admin readbacks are not substitutes for those checks.

The [role coverage matrix](2026-09-13-WMS-ROLE-COVERAGE-GAPS.md) remains open. SMTP, real hardware and named-user acceptance remain separate. No live execution approval was granted by the offline reviewer.
