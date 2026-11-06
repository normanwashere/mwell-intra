# November 6 Release Readiness

Status: deployed to the existing UAT project with scoped retests complete; business journeys and human acceptance remain open. This is not production go-live approval. Use the [current release manifest](../handoffs/current/release-status.json) for the serving version and evidence boundaries.

**For Warehouse Testers**

The update is on UAT. Get your case letters, fresh record links, expected quantities and independent Lead/Quality partner from the coordinator. Use your normal work device, follow the assigned steps, refresh the same record and record what happened. Missing access or data means Blocked. An uncertain save means stop and retain the record, not retry or clear browser storage.

All 24 cases and 90 human result rows remain PENDING. Engineering QA owns the separate 520-cell recovery appendix; Warehouse staff perform only assigned app actions. Existing safe isolated-test approval remains within its original scope. G02 is BLOCKED by missing first-putaway bridge; conversion was not run. G01 is blocked by Auth administration. No real payment, email delivery or human signature is certified.

**Deployment And Evidence**

| Item | Verified scope |
| --- | --- |
| App | `dd9048e405bf84c2b7b0d6647309d1a8747c9378` on [existing UAT](https://mwell-intra-uat.vercel.app/). Deployment `dpl_tghauqxhngHM6opHbBdyriMNyNGV` READY; alias assigned. |
| Health | `2026-11-06T00:34:37.828Z`: exact SHA, `appEnv=uat`, Supabase project `kkoitlvydytdhlpxhuah`, Supabase reachable and static CSS HTTP200. Vercel project `prj_tYR1vpcOlxkAF6jja3meH9L5nL2y`; no new production target or environment change. |
| Hosted CI | [Run42132526254](https://github.com/normanwashere/mwell-intra/actions/runs/42132526254): all 11 jobs succeeded. Memory: 1,854 clean passes plus one retry-pass and 143 exclusions. Controlled: 26 passes and four exclusions, separately counted. |
| Open CI observation | Procurement approvals command-palette mobile320 passed on retry. A separately reviewed test-only settling correction has 12 helper and six route passes with retries zero, but no new hosted closure or proven original hosted trigger. No application-defect or zero-issues claim. |
| Local UI | Main reports final 12/12 checks across 1440/1280/768/390/360/320. Local evidence is not live acceptance. |
| Live privacy | Four scoped checks passed: private/no-store denial, no private response cache, owned-session purge/offline denial and second-actor isolation. Normal Learning navigation side effects are disclosed. |
| Live return balance | At 1440/390, actual RPC remaining0 of issued2; inputs min/max0 and submit disabled. No business submission; stock/hold/return/movement before-after identical. Guard blocked normal `resolve_assignments`; not full unintercepted startup or a completed return. |
| Live Product/export screens | Nine automated checks at 1440/390/320, actual capabilities, scoped main-region axe0 and no overflow. No export requested. Main reviewed all six distinct images; three cold/reload Product pairs are SHA256-identical. No target-area overlap/cutoff observed. |
| G02 | BLOCKED at Q4 after normal receiving, independent accepted QC and first putaway200 to SRC. Origin1/bridge0/history2/break0; exact command receipt and movement exist. Original QC/receipt/lot snapshots unchanged. Recipe approved only; conversion/recovery NOT RUN. No full-readiness endorsement, repeat putaway, old-stock write, replay or backfill. Root cause under independent investigation. |
| G01 | Blocked by unavailable Auth administration for the new synthetic vendor. Do not rebind an existing supplier or substitute seeded approvals. |

Retained evidence paths are relative to the parent workspace:

- `outputs/release-readiness-20261106/deployment-dd9048e.json`, SHA256 `492aea4ad5705985062c20ebb28567cbcf066f9cf7270f697f8d4027b76d47d8`.
- `outputs/release-readiness-20261106/ci-dd9048e-jobs.json` and `ci-dd9048e-shard1.log`, `ci-dd9048e-shard2.log`, `ci-dd9048e-shard3.log`.
- `outputs/four-qa-remediation-20261105/privacy-live-dd9048e405bf-attempt1/evidence.json`.
- `outputs/four-qa-remediation-20261105/qa2-workflows/f03-live-dd9048e405bf-2026-11-06T00-37-10-500Z/evidence.json`.
- `outputs/four-qa-remediation-20261105/qa3-experience/final-browser/dd9048e405bf-2026-11-06T00-38-16-740Z/evidence.json`, supplemented by `outputs/release-readiness-20261106/live-dd9048e-screen-review.md` for main's completed visual review. The earlier QA3 report's visual-pending label is a historical checkpoint.
- `outputs/release-readiness-20261106/qa4-ci/g02-applied-20261105233321.json` and `qa4/g02-applied-catalog-independent-review-20261105233321.md`.
- `outputs/release-readiness-20261106/qa4-ci/g02-q4-post-putaway-20261106T011501Z.json`: read-only Q4 blocker proof at `2026-11-06T01:15:01.934812Z`. Resolver was not evaluated because the required bridge was absent; do not describe this as a false resolver result.
- `outputs/release-readiness-20261106/qa4-ci/REACHABILITY-FOLLOWUP.md`: the local test-only review checkpoint, subsequently pushed as `940089557c3c5e698817e1eb96288ebd6a107fd9`. It is not part of deployed dd9048e. Main verified run42141617943 at8/11 passed with3 browser groups running, not full success. Separate G02 source `20261106012547_stock_conversion_putaway_authoritative_actor.sql` is prepared pending its own CI and application; SHA256 `fcede47f4671ab241d9e0a04face6d626aabb559fe8e72e830d6165342339306`. Its future commit will be recorded externally after creation. No live application or repaired G02 result is claimed.

## What Is Being Finished

The following fixes are now deployed in dd9048e; remaining acceptance is recorded separately below.

- Return screens use the authoritative remaining balance, including previous sales and returns. A failed balance check must not become a zero or permit an unverified return.
- Product links retain their record destination after reload. Export screens explain loading, unavailable data and missing permission without changing access.
- Narrow-screen onboarding keeps the task entry visible; required training, task checkpoints and permissions remain unchanged.
- CI browser setup installs its configured Chromium engine and proves that it can launch before running journeys. Installation failure is still a failure, not a skipped pass.
- Mobile reachability checks use overlapping scroll samples and allow only 0.001px measurement tolerance. Tests still reject real overlays and undersized controls.
- Controlled Procurement fixtures follow real paging, registered payment evidence and independent actor permissions. Their 26 applicable CI passes do not certify live Legal or payment processing.
- Tablet layouts keep Fulfillment filters within the page, allow Insights tabs to wrap, and retain visible Finance status controls. Existing actions, permissions and handoffs are unchanged. Regression checks include reserved scrollbar space so clipping is not hidden by the test device.
- On narrow phones, Fulfillment tabs retain enough width for their labels instead of overlapping. Label-boundary and navigation checks supplement the existing layout audit; tabs that a role cannot use remain hidden, with direct links falling back to an allowed view.
- The Warehouse header keeps a stable height while scrolling. This prevents repeated resizing on short desktop pages while retaining its scroll shadow; keyboard and pointer navigation are tested at the affected scroll position.

## Stock Conversion Follow-Up

An external-PO inspection can accept a serialized unit before its first putaway assigns a bin. The old conversion check expects the inspection and current unit bin to match, leaving that unit without an eligible inspection in the conversion screen.

The applied forward migration records the exact future receipt, independent Quality decision and first single-serial putaway. It keeps the original inspection unchanged and rechecks eligibility when creating, approving and completing a conversion. Later custody, holds, inspection or return changes invalidate this carried evidence. Existing exact-bin inspection and return recovery rules stay intact.

This is deliberately limited to newly recorded eligible stock. It does not repair historical stock, authorize new recipes, certify packaging conversion or remove independent approval. After all 11 CI checks passed for `d4d5967`, UAT recorded the migration as `20261105233321_stock_conversion_qc_putaway_bridge.sql`, replacing the source filename version `20261105195433`. The recorded SQL bytes match the reviewed file. Post-application checks confirmed unchanged existing function permissions, three private RLS-protected tables, six inaccessible internal helpers and the expected triggers/indexes. This proves schema application, not a completed live stock-conversion journey.

The later Q4 live readback found no first-putaway bridge despite successful receipt, independent QC and putaway. Main is preparing a prospective source fix while independent diagnosis continues; it is not part of deployed dd9048e and has no new CI/deployment or journey acceptance here. Keep G02 BLOCKED and preserve the stopped fixture. Do not replay putaway, backfill evidence or rewrite QC.

Normal Learning startup synchronization writes occurred during the authorized G02 UI navigation, alongside the recorded setup/receiving actions; the journey was not read-only. The separate Q4 inspection was read-only. Scans were typed/manual, not physical scanner or camera acceptance. Do not promote this synthetic evidence into hardware or human sign-off.

The migration caps each lock wait at five seconds and each statement at sixty seconds, retains stricter caller limits, and restores those settings at transaction end. This is not a total transaction deadline. A blocked application must fail and be inspected before any retry; active testers are never terminated to make it succeed. The native PostgreSQL gate includes real lock contention and rollback/commit setting checks on an owned scratch table.

## Release Gates

1. Retain completed same-SHA CI/deployment and scoped results above; investigate the disclosed retry-pass without erasing it.
2. Keep G02 stopped at the missing-bridge blocker. Await independent diagnosis and any prospective source repair with its own evidence before an authorized fresh run. Do not replay putaway, rewrite QC, backfill proof or reuse old stock to force acceptance.
3. Complete the approved isolated vendor journey when UAT Auth administration is available. Do not substitute an old vendor, send email, sign a real agreement or make a real payment.
4. Execute assigned WMS variants with independent actors and fresh isolated records, preserving existing tester accounts, stock, approvals and history. Missing prerequisites stay Blocked.
5. Publish actual outcomes and coordinate genuine departmental acceptance. Physical scanners/cameras, reconciliation, restore and support remain separate gates.

The WMS checklist retains 24 cases and 90 lettered variants. Record each variant separately as Pass, Fail, Blocked or Not Run; one successful path does not close an entire case. No core stock, permission, hold or approval failure is waived by this update.

SMTP remains untouched. The Reporting API is a separate, disabled implementation phase.
