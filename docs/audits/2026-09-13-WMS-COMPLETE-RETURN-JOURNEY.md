# Complete Return Journey - September 13

## Result

The automated desktop and mobile return/replacement journey completed on live UAT build `b3a4d68cbcd706e178509ac85b5da8c130bc9685`, database `kkoitlvydytdhlpxhuah`. Run `177f0c97-a6de-4ee4-82b1-37a09f4f5e37` started at `2026-09-13T15:00:17.329Z` and finished at `2026-09-13T15:13:33.893Z`, with no recorded failures.

- 32 source-shipment checkpoints completed before the returns began.
- 28 return checkpoints completed: customer case, linked physical intake, independent inspection/hold release, relocation, replacement picking/packing/release/delivery and customer closure.
- 22 recorded negative/replay probes, including held-stock movement denial and unauthorized hold release, retained unchanged persisted snapshots where required.
- Eight private return/replacement evidence uploads were checked against downloaded bytes. The source shipment has its own two private POD uploads.
- Desktop used the original delivery details; mobile used explicitly confirmed new details.

Stock reconciliation for each synthetic product: ten opening units, minus two in the original shipment, plus one physical return, minus one replacement shipment, equals eight available units. No active hold or replacement reservation remains; the quarantine bin is zero. Opening stock was seeded as a prerequisite and is not receiving or procurement-approval evidence.

## Independent Readback

At `2026-09-13T15:14:58.684116Z`, a separate administrative readback confirmed the following persisted results. This supplements, rather than replaces, the runner's ordinary-user authorization checks.

| View | Source order | Customer case / replacement order | Physical return | Result |
| --- | --- | --- | --- | --- |
| Desktop 1440 | f84ec6ac-5102-483a-9d12-62a141e007e4 | fea31f02-fe3b-4cd9-bd65-8ea6b42e6ce7 | ret-9653612b-bf28-48ae-81dc-faf310924e88 | Case closed; replacement completed/delivered; Quality accepted; hold released; stock 8; quarantine 0 |
| Mobile 390 | 20d448af-be5a-40d7-88fe-2fe287839b7a | 3af625a8-7141-445a-9011-2b37e0b0ad8a | ret-6b0eb97c-85ed-4943-a50d-0055c9bf4436 | Case closed; replacement completed/delivered; Quality accepted; hold released; stock 8; quarantine 0 |

The creator/customer-closure actor was `f662a626-b57d-4990-961c-a086472efddb`. The separate resolution/release actor was `93a08670-c110-4244-97ec-477afcec759c`. These are the existing combined Operations job personas, not proof of every individual warehouse role.

## Evidence

Root: `outputs/wms-signoff/sep13-physical-returns-actor-scoped-live`.

- Return report: `attempt-2026-09-13T15-00-17-329Z-2806dfa6/results.json`, SHA-256 `6cd15a704a5b601c4bdda4626f1c34f280f433b78fdc5f4f15828742fd1e166c`.
- Source report: `source/attempt-2026-09-13T15-00-22-639Z-893b994f/results.json`, SHA-256 `0e570114b88fe9dc0273cbfa51f6a3465d5dee9c7b33fd6357a6acaac79cc6aa`.
- Parent verified all 40 return checkpoint/form PNG hashes, byte lengths and exact viewport dimensions in `parent-file-verification.json` beside the report. The parent reran the completion validator against the saved report.
- Sixteen specific captures were visually reviewed in `parent-visual-review.md` at the root. Several screenshots do not frame the relevant off-screen control; they are not full exact-step certification.

## Remaining Work

This is a completed automated nonserialized accepted-return/replacement journey, not global WMS certification. Other dispositions, serialized/lot/bundle returns, receiving exceptions, full role isolation, concurrency/recovery, independent cleanup and real-hardware/user acceptance remain separate requirements. All run-owned records/photos are retained for evidence review; normal tester data is outside cleanup scope. No actual customer delivery, physical handling or human confirmation is claimed by the synthetic photos and closure references.

Visual findings include stale physical-intake wording in the resolution dialog, incorrect active-tab counts in Quality, raw actor UUIDs, clipped selected bin labels and mobile modal/capture framing. Local candidate fixes now distinguish customer-case status from verified linked physical intake and show Quality counts for the selected tab and search. They do not infer Quality clearance or change custody, permissions or approval logic.

The parent reran the combined workflow-summary, fulfillment and Quality regression selection: 249 tests passed across 16 files. The candidate preview server launch was rejected by the execution policy. A separate server-free browser harness now verifies the actual components and styles with synthetic stores at 1440x900, 390x844 and 320x720: correct count/search states, linked versus unverified intake wording, reachable original/new delivery fields, and a footer inside the viewport. It made no network requests or mutations. This uses system-fallback fonts and is not the full app or live UAT.

The harness captured 33 images under `outputs/wms-signoff/workflow-status-layout/2026-09-13T15-39-26-896Z`; 12 received parent visual inspection, recorded in the adjacent `parent-visual-review.md`. The isolated form can scroll to every checked field without header/footer occlusion. Actual device keyboard behavior, application-font rendering and the full live shell remain unverified. The fixes are not deployed. Raw actor IDs and long selected-bin truncation remain open. Full screenshot certification remains open. SMTP is excluded.

Earlier failed test-tool attempts remain intact in the [attempt history](2026-09-13-WMS-PHYSICAL-RETURNS-LIVE.md); they are not relabelled as passes.
