# Current Release Handoff

The [current release manifest](release-status.json) is the single deployment and acceptance authority for the [Data](data.md), [Technical](technical.md), [Tester](testers.md) and [operating handbook](../../manual/MWELL_INTRA_USER_MANUAL.md) entry points. It separates observed UAT deployment, scoped verification and outstanding acceptance. A documentation build, source change or local test is not a deployment.

## Current Boundary

UAT serves `d45fd6f6827c57e3db1479e25f3207fd6795616d`, READY/PROMOTED `dpl_HRmSECixamMRtpXUsDDVCRJCaqRZ`, health verified `2026-11-06T03:35:37.142Z`: exact SHA, appEnv uat, Supabase reachable/auth configured, CSS200. CI42151736798 passed11/11:1861 memory passes/143 exclusions,26 controlled passes/4 exclusions,0 failures/retries. Actor correction032602 is applied and postverified; G02 is BLOCKED awaiting fresh synthetic-serial approval, conversion/recovery NOT RUN. G01 is blocked by Auth administration. All90 human rows PENDING;520 engineering cells NOT RUN. Earlier dd screen/privacy checks remain historical. See [November6 evidence](../../releases/2026-11-06-RELEASE-READINESS.md). SMTP unchanged; [Reporting API separate/disabled](../../integrations/reporting-api/SEPARATE-IMPLEMENTATION-PHASE.md).

Latest known source/docs is d45fd6f. This final docs checkpoint and byte-identical migration filename reconciliation are offline-only; future commit identity is recorded externally. Live handbook content is not independently verified. Earlier eb CI remains9 success/2 fixture failures;940 remains8 success/3 cancelled. D45 fixture and approvals navigation passed first attempt at six viewports; original dd retry trigger remains unproven.

The [September handoff pack](../2026-09-22/README.md) and its [September 23 manifest](../2026-09-22/release-status.json) are **historical**, including CI212 on `223144f`. Preserve those files and generated packages unchanged. Their date-local use of "current" describes that snapshot, not today's release authority. Do not redistribute the old pack alone as the current handoff. Supply this directory, its manifest and linked source documents together; an older offline HTML copy cannot discover later status automatically.

## Update Procedure

1. Obtain the exact candidate SHA, deployment ID, target environment/project, observation timestamp and retained health evidence from the main release worker. Branch names, local HEAD and build success do not identify a live release.
2. Record the candidate independently. Replace `deployed` only after actual alias/health identity is checked. Preserve the preceding observation and evidence in `history` when advancing it; do not relabel earlier tests as belonging to the new commit.
3. Record each acceptance gate separately with the tested SHA and retained evidence. A skipped, blocked or excluded check stays visible. Missing evidence leaves the gate pending. Production and human acceptance require their own decisions.
4. Keep Reporting API `enabled: false`, its separate-phase boundary and SMTP exclusion unchanged. Never insert secrets, personal sessions, signed URLs or operational credentials.
5. Run the documentation contract tests and regenerate/check the handbook. Retain hashes and actual outcomes in the parent workspace's `outputs/four-qa-remediation-20261105/docs`.

## Documentation Checks

Run from the full repository root:

```sh
node --test scripts/docs/current-release-manifest.test.mjs scripts/docs/handbook-catalog.test.mjs scripts/docs/build-app-documentation.test.mjs
pnpm docs:build
pnpm verify:app-documentation-html
```

The existing handbook sources and catalogue are reused. Supporting current handoffs and integration planning files are linked references, not new app routes or new handbook catalogue entries. Preserve original `outputs/four-qa-review-20261105` reports; remediation evidence belongs in a new output directory.
