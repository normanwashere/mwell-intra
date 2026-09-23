# Reporting Integration Delivery Checklist

## Current Boundary

The security foundation is partial implementation. The operational app can be released separately; the Reporting API must remain unavailable until the gates below are verified. No environment variable, database role membership or client credential is supplied to bypass these gates. SMTP is not a dependency and remains excluded.

The handoff-owned `docs/handoffs/2026-09-22/release-status.json` records the exact app build and current live checks. `FOUNDATION-PROGRESS.md`, `AUTHORITY-FOUNDATION.md`, `DEPENDENCY-REMEDIATION.md` and `source-map.md` record component evidence. A component pass does not close an integration gate.

## Next Steps in Order

| Step | Deliverable | Acceptance before progressing |
| --- | --- | --- |
| 1. Confirm integration ownership | Named Data/Infrastructure contacts, actual recipient stack, managed OAuth issuer, separate environment audiences, secret-manager references | Approved configuration profile; no credentials in documents or browser code |
| 2. Approve the dictionary | Explicit output fields, grains, decimal/date rules, exclusions and relationship handling for all 30 datasets | Business meaning and disclosure approved; ambiguous legacy joins remain flagged, not guessed |
| 3. Isolate runtime identities | Dedicated authority reader/admin, extractor, publisher, retention identities; current-grant adapter and pinned JWKS integration | Real PostgreSQL and Storage negative tests, no operational RPC or private-attachment access, revoke/rotation/outage tests |
| 4. Build capture and publication | Approved projections, consistent capture, fenced publisher, atomic snapshot/change publication, withdrawal interlock, retention and shared quotas | Crash/replay/stale-worker tests; old disclosure blocked immediately; source transaction p95 and capture budgets met |
| 5. Deliver API and connector | Strict authenticated routes, OpenAPI, examples, typed connector and adapters with staged activation/checkpoints | Full bootstrap plus at least four incremental cycles; duplicate/resume/delete/empty generation tests; no partial activation |
| 6. Accept the recipient deployment | Viewer restrictions, quarantine/expiry, purge/restore, incident ownership and monitoring | Joint UAT evidence and accountable go/no-go; no production access inferred from the app release |

## Infrastructure Handoff

- Keep the Reporting API private controls out of exposed PostgREST schemas. NOLOGIN roles are not deployed service credentials.
- Provider selection must verify the actual access-token profile; do not relax issuer, audience, lifetime or current-grant checks to accommodate a mismatch silently.
- Do not reuse the app's Supabase service-role key for extraction or the Data team's connection. Read-only SQL settings do not prevent execution of privileged functions.
- A local ACL test does not prove all privileges on the deployed database. Audit inherited/PUBLIC grants and Storage policies using the actual intended identities before creating any login or role membership.
- Shared quotas and fences must be durable across replicas and restarts. In-memory counters or a scheduled process alone are insufficient.
- Do not expose raw JSON, customer addresses, commercial drafts, still-sealed bids, document contents or signed download URLs merely because the recipient asked for all data.

## Source Transfer

Prefer importing the full Git history into Bitbucket. A source ZIP excludes credentials, hosting settings, database contents and Storage objects. The receiving team must provision and verify its own infrastructure. Rebuild from the lockfile on Node 24/pnpm 10.23.0, apply only reviewed migrations to the confirmed target, and reproduce the documented tests. Historical provenance tests still require Git history.

No certificate of vulnerability-free operation, capacity, human acceptance or production readiness is implied by this checklist.
