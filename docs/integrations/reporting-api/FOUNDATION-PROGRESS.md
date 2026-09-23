# Reporting Security Foundation

September 23, 2026. Experimental branch: `codex/reporting-security-foundation`.
Base: `89875c3f82081c166b219aa35636a01f3b5fdcc3` (full Intra source).

## Follow-Up Delivery

The user subsequently approved the next engineering steps, GitHub push and Vercel UAT deployment. This does **not** approve enabling a Reporting API or issuing machine credentials. The handoff's dated Release Status identifies the actual deployed app build and CI evidence; do not apply the earlier test counts below to a later commit.

- The [draft dictionary and source map](source-map.md) now cover all 30 proposed datasets against 42 read-only UAT relation descriptors. There are 39 dictionary checks. Shell regression with the completed mapping passed 995 tests, with one unchanged opt-in browser test skipped. No business records were queried for this mapping; all datasets remain unavailable.
- [Private authority foundation](AUTHORITY-FOUNDATION.md) documents the inactive schema, current grants, permanent client denial, epochs, audited administrative functions and real PostgreSQL test boundary. It is not source-data or Storage isolation, a deployed identity provider, an HTTP service, or a recipient connector.
- [Dependency remediation](DEPENDENCY-REMEDIATION.md) records the separately verified package updates and compatibility tests. The new full and production registry scans report no known advisories. The earlier nine-entry triage below is historical, not a current unresolved count.
- The local optimized shell build passed on Node 24 with the existing UAT configuration, including TypeScript, 21 static pages and 223 service-worker entries. No reporting endpoint appears in the route output.
- Vercel now installs from the frozen lockfile; the repository and deployment workflow select Node 24. CI retains its production-dependency gate and adds all-dependency Moderate-or-higher checking, hash-vector verification and the required native PostgreSQL authority suite. Five release-contract tests pass, including the clean-runner UI Node-type declaration found by CI209; the absent-gate and missing-dependency checks failed before their fixes.
- Local workspace evidence totals 4,316 passing tests across the full run and complete corrected package reruns, with one unchanged opt-in browser skip. All 15 typechecks and lint tasks passed. The clean GitHub runner exposed the missing UI type declaration despite the earlier local pass; CI209 remains failed historical evidence and the successor must pass independently.
- The Data, Technical and Tester packs include source mapping, current engineering evidence and the [remaining delivery checklist](RELEASE-READINESS.md). Source-transfer and existing CI-contract checks passed (36 tests); these are not app browser or human acceptance evidence.
- CI210 passed build, CodeQL, application tests and database security regressions, then correctly stopped because the September 23 release note was not registered in the standalone handbook. Registered the source, added its canonical/legacy navigation and regenerated the handbook. The successor must complete independently; skipped browser jobs are not passes.
- CI211 passed those engineering stages again, then stopped because three maintained documents still declared 498 legacy routes after registration increased the total to 503. Synchronized the three inventories, including 47 current source documents versus the original 29-source release, and reran both exact CI documentation commands locally. The old source/browser certification remains explicitly historical; no guard was disabled.
- Moved the unchanged documentation gate before lint/tests/build and live provisioning so stale documentation fails early. The new ordering test failed before the move; all seven release-contract tests now pass, including mutations that omit, skip, weaken or delay the check. The combined handbook, source-transfer, release-documentation and CI-resilience suite passed 143/143 on Node 24.
- That broader run also found an obsolete hardcoded 483-route test and Windows-only fixture problems. Updated the exact inventory test to 503 and added all five reporting legacy-link assertions. Pinned the historical evidence manifest to LF in Git attributes and normalized only semantic source parsing in a test. The manifest bytes exactly match its existing Git blob and reviewed SHA-256; no screenshot, evidence approval, digest or provenance assertion changed. Initial four failures are not represented as passes.
- The handbook's source-reading test helpers now normalize Windows line endings before semantic assertions, matching the generator. The initial broader local run exposed 11 CRLF-dependent failures; after normalization all 61 handbook, source-transfer and release-contract checks passed. Raw source-archive byte checks are unchanged.
- Updated the maintained deployment smoke test to use the live Inbox label and expand mobile Filters before accessing Status. All six Marketing, Operations Associate and Admin checks passed at 1440 and 390 pixels on 185fbd9 without business submissions, page errors, server errors or horizontal overflow. Original failed stale-selector results remain historical evidence.
- A separate source-only copy of application 185fbd9 with documentation c781d11 verified all 2,309 manifest files, installed frozen dependencies, passed all 15 typechecks and rebuilt/checked the handoff without Git or ancestor project dependencies. This verifies source portability, not recipient infrastructure or production acceptance.
- A second independent copy of application 223144f / documentation b2f1800 verified its 2,309-file archive, installed frozen dependencies and passed the optimized shell build with TypeScript, 21 static pages and 223 service-worker entries. At 04:52:36 UTC its loopback-only runtime health and hydrated sign-in/logo passed in Chromium with no page errors; the server/browser were stopped. An initial HTML-only sign-in assertion was inappropriate for the client-rendered form, and the first screenshot preceded logo decoding; neither is counted as the final browser result. After building, strict manifest comparison correctly identified only Next.js's regenerated next-env.d.ts. The original archive remains immutable. No fresh backend or copied-deployment transaction certification is claimed.

**Final September 23 UAT check:** CI212 (`35818818312`) passed all 12 jobs on application `223144f3ffbf315d112accac376fa3e187f1d301`. Its clean workspace run passed 4,316 tests across all 15 tasks, with one unchanged opt-in shell browser skip. The six route widths, both 48/48 transaction runs, both independent cleanup jobs and final bundle passed. Native authority 17/17 and DOA 16/16 passed in the mandatory preparation job. Bundle `10734547630` was downloaded and verified against GitHub SHA-256 `859a98fea2f83aae2c4ef0817aef9c20a234fb08dc8072f00a73cb93f92e72ee`; its retention ends October 23. Canonical UAT health still matched this build and backend at 06:07:01 UTC. Read-only counts at 06:07:24 UTC confirmed all four reporting-authority tables remained empty. No API, machine credential or dataset was enabled. SMTP, production, human acceptance, capacity and penetration testing remain outside this certificate.

The following sections preserve the first-slice evidence and decisions. They must not be read as a claim that no follow-up migration or dependency update was made. Current deployment/install details belong to Release Status and the authority ledger.

## First-Slice Scope and Decisions

User approved starting the security foundation, not releasing an API. This slice implements inert libraries and adversarial local tests. It does not introduce routes, migrations, credentials, live grants, storage, source projections, or a recipient connector. SMTP and operational journeys are unchanged.

- Ruling: implement a bounded subset of Tasks 1/2/3/6/7 before the provider and data contracts are approved. Pure validators and crypto tests can be verified now; they do not prove end-to-end authorization. Cost if wrong: integration adapters or contracts may need revision before release.
- Ruling: use the RFC 9068 JWT access-token profile, pinned asymmetric algorithms and an injected current-grant reader. No provider is silently selected. Cost if wrong: the eventual provider needs an explicit profile adapter with equivalent validation, not relaxed checks.
- Ruling: register all 30 proposed dataset IDs as unavailable. Do not invent field mappings or publish generic record data. Cost if wrong: source mapping remains visible outstanding work rather than a misleading successful empty export.

## Local Work

- [x] Strict JSON, catalogue, explicit request schemas, record/dataset hashing, golden vectors. Business-field schemas remain pending source mapping.
- [x] JWT access-token verification and uncached current-grant interface; no live provider/database adapter.
- [x] Request limits and safe continuation/client transport; no endpoint or connector.
- [x] Final negative tests, shell regression/typecheck/lint after independent-review fixes.
- [x] Dependency triage and independent review, with the findings recorded below.
- [x] Update security findings and handoff boundary with actual local evidence.

## Evidence Ledger

Started in a new isolated worktree. Dependencies were installed locally, without junctions to the approved release checkout.

Installed an independent dependency tree. New direct dependencies are pinned: `canonicalize@5.1.0`, `jose@6.2.8`, `jsonc-parser@3.3.1`, `zod@4.4.3`. No existing resolved dependency versions were upgraded; pnpm normalized some existing ESLint peer-resolution labels.

- Tests first: 25 failing contract/JSON/hash checks before implementation; then 39 passed. Authorization: all 36 checks failed before implementation, then passed. Transport: 33 failing checks before implementation, then all 45 passed. Negative tests that merely throw are not counted as prior failing evidence.
- Before independent review: 122 focused checks passed, including one test checking all 12 record and 2 dataset golden vectors. Fixtures use synthetic strings and ephemeral locally generated asymmetric keys, not live credentials. Review-fix results are recorded separately below.
- Full shell regression: 942 passed, one existing browser-only test skipped. The first unconstrained run hit the existing warehouse-import setup's 15-second cold-import timeout. Reran all tests with `--maxWorkers=2`; the seven import tests passed without changing assertions or timeouts.
- Shell TypeScript check passed. Scoped ESLint passed after representing the RFC numeric-rounding example with explicit string-to-number conversion rather than an imprecise source literal.
- `generate-hash-vectors.mjs` regeneration/check passed. Vectors are portable inputs/canonical strings/digests, not production data.
- Frozen-lockfile offline reinstall passed for all 17 workspace projects. No original-checkout dependency junctions were reused.
- Author review added a failing error-serialization test: a mutated error message/status could otherwise leak details or turn denial into HTTP 200. Reconstructing the response from the private error catalogue fixed it; all 122 reporting checks pass.
- Dependency advisory check is **not clean**: seven High and two Moderate entries in existing test/build tooling. No entry named any of the four new direct dependencies. See the dated triage below; this is not a comprehensive dependency-security guarantee.

## What Engineering Can Reuse

| File under `apps/shell/lib/reporting/` | Boundary |
|---|---|
| `catalog.ts`, `contracts.ts` | Exact proposed IDs and strict bootstrap/checkpoint shapes. Does not grant access or approve a field dictionary. |
| `json.ts` | UTF-8 decoding, duplicate keys including escaped aliases, depth, finite/safe-integer JSON values, Unicode and byte limits. Request default 16 KiB; explicit response maximum 5 MiB. Decimals belong in strings. |
| `hashing.ts` | JCS and SHA-256, only `record_hash` omitted from a record, unsigned UTF-8 ID order, duplicate denial and integrity verification. No source schema or recipient activation. Capture metadata must stay in the manifest. |
| `auth.ts` | RFC 9068-style JWT, pinned issuer/single audience/asymmetric algorithms and trusted key resolver, <=10-minute token, fresh grant read each call, permanent-deny flag, immutable principal. Trusted resolver/grant persistence must still be implemented and reviewed. |
| `transport.ts` | Bounded POST JSON reader, query allowlist, HTTPS GET-only reporting-path transport, no redirect/cookie forwarding, response validation and sanitized actionable HTTP failures/Retry-After. Not a retry/checkpoint/activation connector. |
| `errors.ts` | Fixed public errors and no-store/nosniff response headers. Gateway and telemetry redaction remain deployment work. |

The hashing helper deliberately checks integrity separately from business schema and permissions. An attacker can hash their own data; a valid hash is not authentication, disclosure approval, or proof of correct business totals. Do not wire these helpers directly to raw operational tables.

`authorizationValidUntil` is the separate grant-backed recipient stale-serving deadline, at most 30 minutes from verification. `tokenExpiresAt` remains the access-token expiry. Every API call still requires a currently valid token and a new grant read. A confirmed withdrawal must quarantine recipient data immediately, not wait for either deadline; that recipient logic is not implemented here.

## Independent Review and Fixes

A separate agent performed a read-only review and 28 in-memory checks plus all 14 golden vectors. This is independent AI review, not a penetration test or organizational sign-off. Three P2 findings were accepted and fixed in one pass:

| Finding | Reproduction | Correction |
|---|---|---|
| Fragmented reads could exceed the intended memory bound | A valid 400,000-byte response in one-byte chunks exhausted the isolated child process's 96 MiB V8 heap before the fix | One fixed-capacity byte buffer and one deadline race per read, not one retained chunk/reaction per fragment. Added the constrained-heap regression plus stalled-body cancellation checks. |
| Transport erased actionable HTTP status | Tests for 400/401/403/404/409/410/429/503 all returned generic 502 | Preserve only allowlisted status/code pairs and bounded validated Retry-After. Never read or reflect arbitrary upstream error bodies. Retry/quarantine decisions remain the future connector's responsibility. |
| Recipient authorization validity was coupled to bearer expiry | A valid token with 60 seconds left produced only 60 seconds of recipient authorization, despite a fresh grant read | Separate the <=30-minute recipient deadline from token expiry. Expired tokens still fail each API call. Added short/normal/expired-token regressions. |

Each finding had a failing test before the correction. The memory fixture initially failed on test-bundle module resolution; that was corrected and rerun to observe the actual heap-exhaustion failure before changing the reader. Immediately after the three fixes, all 133 reporting checks passed; two additional cancellation/header-sanitization checks are included in the final regression run.

**Final verification:** 135 reporting checks passed as part of **956 passing shell tests**, with zero failures and one unchanged opt-in browser test skipped. All 84 executed test files passed. The constrained-heap fragmentation case passed in 828 ms; this is a focused memory regression, not a capacity benchmark. Final TypeScript and scoped ESLint checks also passed. No live API, managed-provider, real SQL/Storage ACL, deployment, browser journey or human acceptance certification is claimed for this branch.

No review findings were waived. The reviewer correctly left concurrency/capture consistency, ambiguous source child identity, private-source disclosure, failed-capture/restore and recipient double-count behavior unproven: no implementation of those components exists in this slice.

## Reproduce Locally

From this full-app branch, using its declared Node/pnpm toolchain:

```text
pnpm install --frozen-lockfile
pnpm --filter @intra/shell exec vitest run lib/reporting
pnpm --filter @intra/shell exec vitest run --maxWorkers=2
pnpm --filter @intra/shell typecheck
pnpm --filter @intra/shell exec eslint lib/reporting
node scripts/reporting/generate-hash-vectors.mjs
pnpm audit --json
```

The audit command currently exits nonzero because of the inherited advisories. The local regression JSON is `outputs/reporting-security-tests.json`; outputs are not a replacement for committed tests. No environment secrets are required for these library tests.

## Dependency Triage, September 23

| Existing dependency | Advisory entries | Next action |
|---|---|---|
| `brace-expansion` 1.1.15 / 5.0.7 | Five High entries across three advisories, reached through ESLint and Serwist build tooling | Upgrade each affected major to a reviewed patched release (at least 1.1.18 / 5.0.9 for the reported issues), then rerun lint/build and the PWA checks. |
| `js-yaml` 4.3.0 | Two High entries through ESLint configuration tooling | Review/update to at least 4.3.2 and rerun config parsing/lint. |
| `vitest` / `@vitest/mocker` 3.2.6 | Two Moderate entries for the same redirect-mock file-read advisory | Plan a separately tested upgrade to at least 4.1.11. Do not expose a development/mock server; this pass ran Node tests, not an exposed browser-mock service. |

Registry advisories: GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895, GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh, GHSA-82fw-gwwq-j7x9. Counts are advisory/package-version entries, not nine distinct attacks or confirmed runtime exploits. The separate documentation-only toolchain's earlier clean scan does not cover this application toolchain.

Ruling: do not silently upgrade the application's testing major or unrelated build dependencies in this foundation slice. Cost: these inherited advisories remain open engineering work and must be resolved/assessed before a reporting release is accepted.

## Next Engineering Steps

1. Verify live source definitions and approve the explicit field dictionary and relationship grains for all 30 datasets. Keep private drafts, sealed bids, contacts and document bodies out by default.
2. Implement durable principals, disclosure epochs, deny records, scoped idempotency and shared quotas. Prove real database and Storage denials for each service identity; read-only flags are not a permission boundary.
3. Integrate the approved identity provider with pinned JWKS, timeout/cache/rotation policy and separate audience per environment. No credential sharing with the Data team.
4. Add fenced consistent capture, atomic snapshot/diff publication, historical withdrawal and retention controls. Then wire authenticated routes, strict public schemas and gateway redaction.
5. Deliver and verify the recipient connector's staged activation, checkpoint recovery, authorization expiry and quarantine. Run live acceptance, load and full workflow regression only after this infrastructure exists.

The Data team can review the proposed contracts and golden vectors now. They still cannot connect to a delivered Reporting API or use a runnable connector.

## Release Boundary

No reporting API is live. All R01-R12 remain release-gated until their complete evidence requirements are met. The first-slice verification did not change UAT or the earlier verified source-transfer package. The separately approved follow-up is recorded above and in the handoff's Release Status.

Keep the earlier verified source ZIP immutable. Any follow-up source-transfer package must identify its own application commit, documentation revision, checksum and test boundary. A deployed app containing inactive helpers is not a certified Reporting API.
