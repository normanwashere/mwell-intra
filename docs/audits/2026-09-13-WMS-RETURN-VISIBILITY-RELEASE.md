# Warehouse Return And Visibility Update

## Deployed

The application changes first shipped as `0079161354f38ac93ffc5f679dd1353760461513` from deployment `dpl_AM4bUuTuwB53x25c7CbTi1oguRrk`. The documentation follow-up `b3a4d68cbcd706e178509ac85b5da8c130bc9685` is now live from deployment `dpl_FyrDmxiDcEyPh2yE88qu59tN1em9`; it does not change application workflow components. The fresh alias health check at `2026-09-13T14:02:55.766Z` confirmed that exact commit, `appEnv=uat`, database project `kkoitlvydytdhlpxhuah`, and reachable database and CSS assets. Production was not targeted.

The parent signed in as the existing Operations Lead and directly inspected the live `feature-warehouse-returns` KB article. Its task guide now describes optional Original order and Customer return case links, opening an unsent intake, preserving unfinished drafts, quarantine intake and separate Quality authority. No pending-release wording appeared in those controls. Historical screen-guide images remain explicitly labeled as an earlier build; they do not certify the new controls. The live UI crawl below remains attributed to `0079161`, not relabeled as a `b3a4d68` run.

The database migration `20260913071110_customer_return_intake_lineage` was applied before the app. Nullable original-order and customer-case links and their indexes are present. Public intake authorization, table read policy and the certified wrapper definition remain unchanged. The private validator and retained implementation remain owner-only with an empty search path. The security-advisor comparison found no new notices; the same 13 informational no-policy notices remain.

## What Changed

- Physical customer returns can carry their original order and customer return case. Context links open an unsent form, preserve another unfinished draft, and do not approve Quality disposition or customer resolution.
- Attached receiving, Quality and return photos use the existing full-size preview before submission. Closing the preview leaves the form unsent. Live pre-submit upload/preview verification is still part of the next owned return transaction run; it is not established by the read-only crawl below.
- Storage cards retain full bin codes and labels, with the zone on a separate secondary row. Existing scan, Edit, putaway and bin-selection actions are unchanged.
- Physical-return and resolution actions have distinct spacing.

## Live Visual Evidence

Business-read-only crawl completed at `2026-09-13T10:20:40.192Z`:

`outputs/wms-signoff/sep13-inbound-full-live/supplement-release-0079161-1789294798247/report.json`

Report SHA-256: `b683fa11ecc78ae45d8b64acd2cfde96a4965f885662a8835c8bf83b8c74c320`.

Twelve viewport screenshots and twelve matching full-page files were saved and independently hash-checked by the parent. All twelve viewport captures were visually reviewed. Full-page files were hash-checked, not separately visually certified.

| Surface | Desktop 1440px and mobile 390px observation |
| --- | --- |
| Completed Quality | Correct retained inspection, accepted seven units and a loaded exact private evidence thumbnail |
| Storage list | Complete destination and QC bin codes; labels and secondary zones wrap without overlap or ellipsis |
| Destination contents | Full product/SKU identity and seven units |
| QC-bin contents | Correct bin opens and is empty |
| Return intake | Optional original-order and customer-case controls load; physical Quality handoff remains clear |
| Return submission | Attach and submit controls fit; incomplete intake remains disabled |

Zero blocked requests, zero page errors and zero horizontal page overflow were recorded. The guard denies business mutations and uploads; own-session learning bootstrap and exact inspection-image signing reads are explicitly classified. No receipt, return, QC decision, stock move or evidence upload was submitted.

The original inbound transactions remain bound to build `63a52fc`; these are later UI captures on `0079161`, not rerun transaction evidence. The parent also opened the live return screen through the in-app browser as Operations Lead, observed both optional fields and a disabled Record return action, and found no captured console errors. That additional observation is not a persisted transaction test.

## Regression Finding

The first full warehouse unit run completed with 999 passes and one failure. The denied-acknowledgment test selected the mocked photo's `Evidence unavailable` alert before the asynchronous receipt-denial alert appeared. The focused rerun reproduced it. The test now waits for the exact receipt-denial text and checks its alert role, retained reference/evidence, and a single command with the original payload. All 42 fulfillment-feedback tests passed afterward, followed by a complete rerun: **1,000 tests passed across 107 files**. This was a test-selector correction; no app error handling or business authorization was changed. The documentation candidate also passed 60 KB tests, 39 handbook-guide tests, generated-handbook freshness and the production build including TypeScript.

## Still Open

Full physical-return/QC/hold release/relocation/replacement execution, receiving exceptions, all isolated roles and combined-role boundaries, broader inventory types, concurrency/fault recovery and verified remaining-fixture cleanup still need their full evidence. Actual warehouse hardware and named-user pilot acceptance remain pending. SMTP is excluded. This release is not full WMS certification.
