# Reporting API: Security and Integration Review

September 20, 2026. Revision 2. Scope: proposed Warehouse/Procurement integration, all departments and locations. Outcome: substantive design gaps found and revised; implementation/security certification remains outstanding.

## September 23 Engineering Update

The security foundation exists on `codex/reporting-security-foundation`, based on the full Intra transfer source `89875c3f82081c166b219aa35636a01f3b5fdcc3`. The follow-up adds a draft source dictionary, inactive private authority controls and dependency remediation. Use the handoff Release Status for deployment evidence; none of this enables a Reporting API. The previously verified source ZIP is immutable. See [implementation evidence and remaining work](FOUNDATION-PROGRESS.md).

| Finding | Implemented foundation (not an enabled API) | What is still required |
|---|---|---|
| R01 | Pinned asymmetric JWT access-token checks, <=600-second lifetime, strict claims/header parsing, fresh grant callback, bounded grant-read timeout; private durable grant/epoch/permanent-deny controls installed empty on UAT and verified on native PostgreSQL | Managed provider/JWKS and actual authority adapter, approved client administration, key-rotation/restore procedure and authenticated HTTP denial tests; sender constraints remain an infrastructure decision |
| R04 | Private NOLOGIN owner/admin/reader roles, fixed-search-path functions, explicit closed ACLs and native PostgreSQL negative tests; live UAT app-role denial checked | Actual extractor/publisher/reader identities and Storage IAM; resolve inherited/PUBLIC operational RPC exposure before granting any runtime login/membership; full direct SQL/Storage denial matrix |
| R03 | Closed 30-ID registry, strict bootstrap/checkpoint shapes and draft per-field dictionary checked against UAT metadata; every dataset remains unavailable | Field/disclosure approval, implemented projections, audience-specific manifests/counts/relationships and scoped durable idempotency |
| R09 | Maintained JCS canonicalization, record/dataset hash verification, duplicate-ID denial, UTF-8 ID sorting and 14 published golden vectors | Dataset-specific semantic/schema validation, paged staging, source projections and recipient activation/reconciliation |
| R12 | Duplicate-key/Unicode/depth/size validation, bounded JSON body/response reads, same-origin reporting-path allowlist, no redirect/cookie forwarding, strict response-schema hook and fixed public errors | Route wiring, trusted gateway behavior and logging, SQL parameterization, deployment request fuzzing and real recipient output escaping |

These are partial engineering results, not closure of R01/R03/R04/R09/R12. R02/R05-R08/R10/R11 still need their stateful database, storage and recipient controls. None of the twelve findings is fully certified. The existing app workflows and SMTP are unchanged. See the [authority installation and limitations](AUTHORITY-FOUNDATION.md).

## Review Verdict

Do not build the original draft unchanged. Its main omissions concerned historical disclosure, credential exposure, partial generation publication, stale-worker rollback, sync recovery and the recipient's own access controls. The revised design has explicit controls and test gates for each; this is not proof that the application has no vulnerabilities.

Two independent AI reviewers performed read-only static reviews: one focused on security and consistency, the other on developer experience and synchronization. Their overlapping observations were consolidated with the primary review into R01-R12 below. No credentials, live data, external dashboard, API implementation or cloud configuration were tested. Independent review here means a separate agent review, not a human penetration test or organizational approval.

## Findings and Required Evidence

P1 means release-blocking design risk; P2 means important bounded behavior/operability risk. These priorities are not CVSS scores or confirmed incidents. Every row is **revised in the plan; runtime verification pending** for release. The September 23 table distinguishes the locally tested foundation from the remaining integrated evidence.

| ID | Priority | Original weakness and impact | Revised control | Required test / implementation owner |
|---|---|---|---|---|
| R01 | P1 | A 90-day bearer could expose all approved commercial data if stolen; no strong managed machine identity | Managed OAuth client credentials, asymmetric registration preferred, <=10-minute audience-bound tokens, current grant checks and rapid revocation; no service-role sharing | Wrong issuer/audience/algorithm; old token after revoke; key rotation; grant-store outage. Task 2 / security + backend |
| R02 | P1 | A withdrawn quotation could remain readable in an old snapshot or 30-day change segment with unchanged grants | Current disclosure epoch plus authoritative withdrawal interlock; historical pages blocked and recipient quarantines/purges before rebuild | Disclosed -> withdrawn with same client, old cursor and no replacement ready; stale publisher rejected. Tasks 2/3/5 |
| R03 | P1 | Shared manifests/counts/links might expose excluded dataset information; idempotency could cross consumers | Separate internal/public manifest types, allowlisted audience bundle, principal/environment/epoch namespaces; no object keys | Two differently scoped clients use same idempotency key; inspect hashes/counts/FKs/error output for disclosure. Tasks 1/5/6 |
| R04 | P1 | A broadly privileged API/capture identity could change grants, overwrite files or reach business attachments | Separate extractor, publisher, reader, retention and client administrator; least privilege/default grant audit; private immutable environment-separated objects | Direct SQL/storage denial tests for each prohibited operation, including ACL/list/signing privileges. Tasks 2/4/8 |
| R05 | P1 | An expired lease did not stop a paused producer or consumer from publishing older data over newer data | Fencing token + epoch + expected predecessor checks at both publication and recipient activation | Pause A, let B commit, resume A; A cannot advance pointers or checkpoints. Tasks 4/5/7 |
| R06 | P1 | Snapshot became ready before changes existed; a crash could create a sync hole | Private captured state; snapshot, changes and target manifest validate before one atomic ready publication | Crash after snapshot upload and before diff; no public readiness or skipped change transition. Tasks 4/5 |
| R07 | P1 | Stale serving could retain withdrawn data indefinitely; all-department backend access could leak through dashboard viewers | Immediate quarantine on confirmed withdrawal, <=30-minute authorization-validity window, recipient viewer restrictions and purge/restore agreement | Withdrawal offline/no new snapshot; denied viewer cannot read/export; stale access expires separately from data age. Tasks 7/8/9 |
| R08 | P1 | Undefined caught-up state, snapshot completion and incremental manifests could cause skipping, early activation or endless polling | Stream-scoped fixed bundle; G checkpoint means strictly after G; separate dataset_complete; explicit caught_up; target manifests retained 30 days | Empty dataset, empty generation, no new generation, backwards/wrong-stream acknowledgement, 48-hour-old snapshot with valid changes. Tasks 5/6/7 |
| R09 | P2 | Unspecified hash encoding would make different languages disagree or falsely pass reconciliation | RFC 8785 canonicalization, explicit exclusions, stable UTF-8 record ordering and golden vectors; supplied verifier | Null/absent/Unicode/decimal/array fixtures produce identical documented digests; corrupted page is never activated. Tasks 1/3/7 |
| R10 | P2 | Request rate limits did not bound pin count, retained storage or total download cost | 2 active pins, 4 fresh pins/day, finite byte/staging/global budgets and shared admission control | Fresh-key pin spam, many principals, slow reads, abandoned staging, byte exhaustion and idempotent retry. Tasks 2/4/6/8 |
| R11 | P2 | Last-good fallback could override retention forever; old pins and cleanup races were unspecified | 48-hour pin, max 96-hour snapshot age, 30-day change/manifests, 24-hour staging, 60-second read lease and bounded backup/version rules | Pin old snapshot, expire during outage, delete during page read, restore old backup; no silent stale success or unauthorized revival. Tasks 5/8/9 |
| R12 | P1 | Method/body/path limits, redirect safety and downstream string handling were under-specified | JSON schema/limits, no arbitrary SQL/URLs/object paths, same-origin continuation, redirect refusal, parameterized SQL and escaped dashboard output | SQL/path/header injection, duplicate keys/query parameters, poisoned next URL, wrong content type and secret/log scans. Tasks 3/6/7/8 |

## What Is Easier for the Data Team

- One approved Phase 1 bundle rather than 30 separately configured feeds or hand-built selection rules.
- A supplied connector with `doctor`, `sync --once` and `sync --interval 900`; automatic short-lived-token renewal.
- Tested PostgreSQL adapter and SQLite demo, plus typed client/OpenAPI, Postman examples and synthetic data. Other languages can use the same ordinary HTTPS contract.
- One persisted stream/checkpoint; the connector handles page cursors, deduplication, child replacement, hashes and failed-run resume.
- Copyable relationship recipes for request/PO/receipt/inventory/return reporting, with explicit grain and decimal handling.
- A recovery table tells them when to retry, refresh identity, rebuild, or quarantine. No guesswork based on an empty response.

These are requirements for the implementation deliverable, not completed connector features.

## Second Review Corrections

The follow-up reviews identified four additional details, now included in the spec/plan: permanently deny a compromised OAuth client ID so old tokens cannot regain access after key rotation (R01); atomically fence local activation against quarantine/disclosure/deadline changes (R05/R07); drain queued generations immediately until caught_up (R08); and distinguish one automatic access-token refresh from terminal client revocation (R01/R08). These remain implementation test obligations, not executed security results.

Final targeted re-review: both separate agents confirmed their remaining design findings were addressed in the revised text. The security reviewer identified no remaining P1 within those reviewed findings; the integration reviewer identified no unresolved finding within its review. Six local document checks and browser checks for four tabs, two diagrams, search, links and desktop overflow passed. These checks validate the planning artifacts, not the future API, managed identity provider, storage permissions or recipient implementation.

## Residual Risks and Release Blockers

1. A valid stolen bearer access token is still replayable during its short lifetime unless sender-constrained tokens are deployed. Managed OAuth is not a guarantee against backend compromise. Evaluate mTLS/certificate-bound tokens for the deployment profile.
2. An authorized all-location integration necessarily receives broad commercial information. Intra cannot prevent an authorized recipient from copying it or enforce its backup purge technically; the recipient's access, encryption, retention and incident obligations are release conditions.
3. Managed identity provider support, durable worker hosting, narrowly scoped storage/DB identities and disclosure interlocks have not been demonstrated. Failure to meet them blocks live access; an agent cannot waive them by marking the plan complete.
4. Full snapshot/diff capture must meet measured runtime and source-load budgets. If not, a replica/CDC extraction redesign is required before release, with the same consumer contract.
5. The actual recipient language/database, named integration owner, downstream viewers, approved egress/retention capacity and incident contacts still need confirmation. Proposed TypeScript/PostgreSQL defaults do not establish what their app uses.
6. A compromised trusted publisher can corrupt or exfiltrate its permitted source data. Least privilege, immutable versions, review and detection reduce risk; hashes do not establish safety against a malicious publisher.

## Verification Required Before Live Access

- Real PostgreSQL and storage IAM negative tests, plus authenticated HTTP probes using valid and invalid machine principals.
- Secret/dependency scans, request fuzzing, cache/gateway inspection and direct checks for old-snapshot disclosure. No unresolved Critical/High exploitable reporting issue may ship.
- Full bootstrap, four 15-minute incremental cycles, interrupted run, duplicate retry, stale-worker fencing, wrong epoch and source-restore simulation.
- Exact record counts/hashes and correct business totals, preserving Warehouse/Procurement workflow regression.
- Recipient restricted-viewer tests and a rehearsed revocation/quarantine/purge process, including restore from backup.
- Independent security/correctness review of the implemented release plus accountable organizational acceptance. Screenshots or unit tests alone do not certify this integration.

## References and Limits

The review was informed by [OWASP API property authorization](https://api-security.owasp.org/editions/2023/en/0xa3-broken-object-property-level-authorization/), [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html), [OAuth security BCP RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) and [JCS RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html). Local lifetimes, quotas and service targets are proposed implementation choices, not certifications or requirements quoted from these references.
