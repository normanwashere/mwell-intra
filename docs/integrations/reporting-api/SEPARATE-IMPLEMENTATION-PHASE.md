# Reporting API: Separate Implementation Phase

November 5, 2026 scope clarification. **The Reporting API and connector remain disabled and undelivered.** SCOPE-01 remains open; it is not closed by app remediation, documentation, CSV export or a security-helper test. The [current release manifest](../../handoffs/current/release-status.json) governs app deployment status, not permission to expose this integration. SMTP is excluded.

This outline carries forward the boundaries in the [design](../../superpowers/specs/2026-09-20-reporting-api-design.md), [implementation plan](../../superpowers/plans/2026-09-20-reporting-api-implementation.md), [security review](SECURITY-REVIEW.md), [authority foundation](AUTHORITY-FOUNDATION.md) and [delivery checklist](RELEASE-READINESS.md). Design review is not operational/security or recipient approval. No API routes, datasets, runtime logins, client credentials or production access are published by this document.

## Decisions Still Missing

| Decision | Status and required record |
| --- | --- |
| Managed identity provider and token profile | Provider selection/approval pending. Confirm actual issuer/JWKS, asymmetric machine-client support, environment-separated audiences, lifetime and rotation/revocation behavior; evaluate sender constraints without silently weakening the design. |
| Dataset fields and disclosure | Dictionary approval pending for all 30 dataset definitions, grain, null/decimal/date semantics, stable keys, joins, exclusions and retention. The draft dictionary/source map is not an approved export. |
| Recipient and accountability | No named integration owner is confirmed in this handoff. Confirm actual backend runtime/database, network, scheduler, technical/security/incident contacts and authorized viewers; do not assume proposed TypeScript/PostgreSQL defaults were accepted. |
| Infrastructure and operations | Approve isolated identities, private Storage, durable workers, quotas/fences, source-load budget, restore/withdrawal process and downstream retention. Secret-manager references only; no secret values in acceptance records. |

## Delivery Order

1. Resolve and retain the above approvals. Keep every dataset unavailable until its explicit projection and disclosure are approved; unsupported required data is not a successful empty dataset.
2. Integrate the managed OAuth/JWKS and current-grant adapter. Keep access tokens audience/environment bound with at most 600-second lifetime, current grant/epoch checks and permanent compromised-client denial. Use separate authority reader/admin, extractor, publisher and retention identities. Audit direct/inherited/PUBLIC SQL and Storage privileges; never reuse an app service-role key or grant operational RPC/attachment access.
3. Implement consistent capture and atomic publication: fixed approved bundle, fenced producer, expected predecessor and epoch checks, validated snapshot/change/manifest pair, immediate disclosure-withdrawal interlock, durable shared quotas and bounded retention. A crash, stale worker or missing change segment must not expose a ready generation.
4. Implement strictly authenticated routes with private/no-store responses, bounded parsing/body/page limits, fixed public errors, parameterized data access, no arbitrary SQL/paths/URLs, same-origin continuation and no secret forwarding. Preserve scoped counts and relationships; do not leak omitted datasets, raw JSON, private contacts, bank details, documents, signed URLs, drafts or sealed bids.
5. Deliver the typed connector and confirmed adapters with staged bootstrap, schema/count/hash verification, stable-ID replacement and deletions, atomic data/checkpoint activation, duplicate/resume safety, bounded retry and explicit caught-up behavior. Enforce consumer fencing and immediate quarantine on withdrawal/revocation; authorization validity is separate from freshness and bounded to at most 30 minutes.
6. Run isolated joint UAT and independent security/correctness review of the implemented release. Record recipient and accountable release acceptance explicitly; production remains a separate go/no-go. Existing Warehouse/Procurement workflows and tester data must survive unchanged.

## No-Secret Handoff

Provide an exact source/release manifest, approved dictionary and relationship examples, OpenAPI, typed client, confirmed adapter, SQLite demonstration, Postman collection, synthetic samples/hash vectors, redacted diagnostics and recovery/incident runbooks. Proposed `doctor`, `sync --once` and `sync --interval 900` commands in the [Data quickstart](DATA-TEAM-QUICKSTART.md) are future deliverables, not installed working tools.

Exchange only approved configuration identifiers and secret-manager references through the agreed channel. Never send tokens, private keys, database passwords, service-role keys, signed download URLs, browser sessions or raw business records in documents, CLI arguments or logs. A recipient database/credential is environment-specific; changing a URL must not cross UAT into production.

## Acceptance: Bootstrap And Four Incremental Cycles

These tests are **not run**. Record the candidate SHA, environment, controlled fixture IDs, source capture/apply times, counts/hashes, checkpoints, failure outcomes and recipient acknowledgement. Run a complete bootstrap, then at least four incremental cycles on the agreed 15-minute schedule:

| Run | Required result |
| --- | --- |
| Bootstrap | Every required approved dataset validates in staging, then one complete generation activates; restricted viewers cannot read/export unauthorized data. |
| Cycle 1 | Known synthetic insert/update reconciles by stable ID and business totals without duplication. |
| Cycle 2 | Controlled deletion/removal and an empty dataset or generation apply correctly; caught-up state advances only according to the contract. |
| Cycle 3 | Interrupt a page/load, restart and retry a duplicate; resume the same saved progress with no lost/duplicated rows and no partial activation. |
| Cycle 4 | Exercise revocation/disclosure withdrawal with no replacement ready; old cursors and cached active/staged/derived data are denied/quarantined. Only an explicitly reauthorized recovery can bootstrap; old compromised-client tokens stay denied. |

Also verify key rotation, grant-store outage, invalid issuer/audience/environment, wrong epoch, stale producer/consumer fencing, hash/count corruption, snapshot/checkpoint expiry, quota exhaustion, source restore and purge-on-backup-restore. Test wrong-scope viewers, SQL/Storage negative access and request/log/secret boundaries. Preserve prior active data only within authorization-validity rules; never retain revoked disclosure as a last-good fallback.

The first connection's proposed 30-minute setup target and source performance/freshness budgets must be measured, not promised. Four cycles, unit tests or screenshots alone do not certify the integration. Missing provider/dictionary/recipient approval, security evidence or accountable acceptance keeps access disabled.
