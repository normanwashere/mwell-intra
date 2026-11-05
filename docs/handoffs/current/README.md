# Current Release Handoff

The [current release manifest](release-status.json) is the single deployment and acceptance authority for the [Data](data.md), [Technical](technical.md), [Tester](testers.md) and [operating handbook](../../manual/MWELL_INTRA_USER_MANUAL.md) entry points. It separates the last observed UAT build from an unverified remediation candidate. A documentation build, source change or local test is not a deployment.

## Current Boundary

The manifest retains the November 5 review's last verified UAT identity. The main release worker has not yet supplied the new immutable candidate, actual deployment or matching retest evidence to this handoff. All four-QA remediation deployment and acceptance claims remain pending. SMTP is excluded. The Reporting API remains disabled and belongs to a [separate implementation phase](../../integrations/reporting-api/SEPARATE-IMPLEMENTATION-PHASE.md); SCOPE-01 is not closed by this remediation.

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
