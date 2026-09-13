# Physical Return Live Test - September 13

## Scope

Live UAT only: `https://mwell-intra-uat.vercel.app`, database `kkoitlvydytdhlpxhuah`, application build `b3a4d68cbcd706e178509ac85b5da8c130bc9685`. Run `149287f4-a64f-4267-9360-ab199f4fa100` uses two synthetic nonserialized products, two source bins and two return quarantine bins. Each starts with ten units. These inserts are prerequisites, not receiving evidence. No roles, permissions, business orders or evidence were seeded.

The intended journey is source shipment, customer case, linked physical intake, independent hold inspection, independent accepted release, relocation, replacement shipment and customer closure. Desktop uses the original delivery address; mobile uses a confirmed replacement address. Other dispositions, serialized stock and human custody are separate requirements.

## Source Shipments Completed

The source run completed all 32 recorded desktop/mobile checks on this build, including wrong-bin denial, independent release, failed delivery, retry, private proof of delivery and idempotent tracking. Its report remains immutable:

`outputs/wms-signoff/sep13-physical-returns-live/source/attempt-2026-09-13T14-03-52-102Z-ff60a215/results.json`

SHA-256: `b1d40b92d1e3c1e290863d20a222c0ec5d16dfb8025ade470fd17ebe98f8269a`.

| View | Source order | Final source stock |
| --- | --- | --- |
| Desktop 1440 | `eeb2a86f-e464-4bf6-a052-56a157aad39d` | 8 units |
| Mobile 390 | `e52511cf-b8c2-4523-9e0e-b7f8abae3b9c` | 8 units |

The parent independently queried UAT at `2026-09-13T14:10:29.462738Z`: both orders were completed/delivered with their run-specific POD references, created/packed by `f662a626-b57d-4990-961c-a086472efddb` and released by the different operator `93a08670-c110-4244-97ec-477afcec759c`. A separate stock read showed eight units in each source bin. There were zero linked physical returns and zero customer cases for these products.

The parent visually reviewed the desktop and mobile wrong-bin captures. The recovery message, expected bin code, order-reference disclosure, scan control and fixed confirmation footer were readable and did not overlap. This is not visual certification of every source screenshot.

All 32 source screenshot files were byte-hashed and their PNG header dimensions checked in the adjacent `parent-file-verification.json`. The first two desktop captures are full-page images measuring 1440 by 66847 pixels, so they are not useful substitutes for exact-step viewport review. Future source runs need a separate bounded viewport capture. These original images remain unchanged; only the two wrong-bin captures have parent visual-review credit.

## Test-Tool Failure Before Returns

The root attempt stopped at `2026-09-13T14:08:57.673Z` before any return command, binding or evidence upload. A strict comparison of an in-memory report with its saved JSON rejected the omitted `action: undefined` field on source order creation. The completed source transactions did not fail.

Original failed report:

`outputs/wms-signoff/sep13-physical-returns-live/attempt-2026-09-13T14-03-47-166Z-ed58e179/results.json`

SHA-256: `76760be85caaae4f5d0020ad84f6a0307e46de8d9ad4dae34f849e985189ade6`.

The runner now compares the JSON-safe report representation and supports an explicitly pinned continuation from this pre-return boundary. Its offline inspection validates all 32 source checkpoints and 80 original files. The archive hash is `899952a88ed9ada1b2d25568d0e9d941793e76db72883fc65c0a2a42bf83dd3a`; it includes the failed attempt's exact two-file inventory and rejects unexpected command/upload evidence. Recreating source orders or general partial-return replay is not authorized. The failed report remains unchanged, not relabeled as a pass.

The local combined regression run passed 74 tests, including an actual Chromium viewport-capture test at desktop 1440x900 and mobile 390x844 on a 66847-pixel-tall fixture page. The browser test is separate from the ordinary Node tests. Five retained-artifact checks require the saved local run and explicitly skip when those artifacts are absent; this count is not a clean-CI certification claim. Tests copy only the original boundary into isolated temporary fixtures, so later live attempts cannot change their result. The final continuation is awaiting independent review before live execution.

## Status

The approved continuation ran at `2026-09-13T14:36:07.471Z` and stopped during its first read-only preflight query. The second failed attempt is retained at `attempt-2026-09-13T14-36-07-471Z-f4e1e842/results.json`. It contains zero return bindings, commands or uploads. No return transaction had started.

The diagnostic reproduced a test-runner query-encoding defect: passing a JavaScript array of objects directly to the SDK's containment filter produced HTTP 400 / `22P02`; passing its JSON string returned HTTP 200 with exactly the owned order. `readScopedRows` now sends JSON containment correctly while retaining exact-count and size checks. An SDK wire-format regression was added, and the combined local suite passed 75 tests. The corrected helper was then called on live UAT as both ordinary test actors at `2026-09-13T14:40:06.305Z`: each could read the two exact completed/delivered source orders, with zero matching physical returns or customer cases. That read-only proof is `outputs/wms-signoff/sep13-physical-returns-live/json-filter-readback.json`.

The original continuation permission is not generalized to arbitrary retries. Both failed attempts remain preserved. These prior source shipments will not be represented as uninterrupted physical-return evidence.

At `2026-09-13T14:43:41.840Z`, the corrected ordinary-user preflight finished comparing both source orders and their complete product, stock, movement, reservation, hold, allocation, unit and activity snapshots to the pinned completed source report. Both matched; customer cases, physical returns and inspections remained empty. Evidence: `outputs/wms-signoff/sep13-physical-returns-live/corrected-preflight-readback.json`.

## Fresh Continuous Attempt

Independent review approved the transport correction, with 75 local tests passing and no skipped checks. A separate fresh run, `f47a094d-fab0-4460-b973-56d1e8e9033e`, executed under `outputs/wms-signoff/sep13-physical-returns-fresh-live`. It does not reuse or overwrite the earlier attempts. Live health at `2026-09-13T14:48:27.665Z` confirmed the same UAT database and exact `b3a4d68` build. Ten insert-only fixture statements were executed once; independent database readback at `2026-09-13T14:49:02.473886Z` confirmed two owned synthetic products with ten units each. No authority, order or evidence was seeded.

The fresh source run completed all 32 checks at both viewport sizes. Report: `source/attempt-2026-09-13T14-49-19-089Z-3c3a08f7/results.json`, SHA-256 `4789ab577d4b32ca5e4b53c3682fc5257e0717768051a06ba60bfd48718bb66f`. Its bounded screenshots replace the unusably tall capture method for this new run only. Eight source images have a parent visual review; minor action spacing, clipped mobile select text and an off-screen POD capture limitation are documented in the adjacent `parent-visual-review.md`. This is not full screenshot certification.

The root attempt terminated at `2026-09-13T14:54:12.998Z`, after successfully creating desktop customer case `61f3a8c3-97d2-4590-a3a7-4f98eac33d65` against source order `c1b5ff53-913e-4c38-ae85-1c8fb99ca016`. The runner stopped at `Exactly one submitted audit required`, before physical intake or return evidence uploads. Root report: `attempt-2026-09-13T14-49-13-962Z-dd86401c/results.json`, SHA-256 `f249a8f04197d9e30ae26876b11b108b2f88bb3961b7647a97d42afe17e0d34f`. This is a failed partial run, not completed return certification.

The actual submission event exists (activity ID `141948`, creator `f662a626-b57d-4990-961c-a086472efddb`). The live `core_activity_read` policy permits `view_audit` holders or the event's own actor. The test incorrectly read all case events as the supervisor. No policy or role widening was needed. The runner now queries each of the two verified ordinary actors' own events, with exact entity/actor filters and per-actor readback provenance. A test was added before the fix; the combined local suite then passed 76 tests. The corrected helper was exercised read-only on live UAT at `2026-09-13T14:57:07.086Z`: the creator read the one submitted event, and the supervisor correctly read zero. Evidence: `actor-audit-readback.json`, SHA-256 `59e8b620ff1f3a31d3cd35d01cc3060fa9d124b31033a306a584d40529739b51`. Independent review of this correction is pending; no follow-on mutation has run.

Independent review subsequently passed the own-actor reader and caller, including 76 tests plus additional malformed, denied, incomplete and foreign-row probes. A third distinct run, `177f0c97-a6de-4ee4-82b1-37a09f4f5e37`, then ran under `outputs/wms-signoff/sep13-physical-returns-actor-scoped-live` against the same build. Its fresh insert-only fixtures were independently read back at `2026-09-13T15:00:16.750336Z`.

All prerequisites and generated records remain run-owned and retained until separately reviewed cleanup. The earlier zero-return continuation cannot be used for this partially created case.

## Completed Third Run

The third run finished successfully at `2026-09-13T15:13:33.893Z`: all 32 source-shipment and 28 return checkpoints passed across desktop and mobile. Both customer cases closed, both replacements were delivered, and each synthetic product finished with eight available units and zero in quarantine. The separate administrative readback confirmed these outcomes at `2026-09-13T15:14:58.684116Z`.

See the [completed journey report](2026-09-13-WMS-COMPLETE-RETURN-JOURNEY.md) for exact records, report hashes, negative probes and visual-review limits. The earlier failed attempts above remain failures; they are not overwritten or combined into a passing continuous run.

This proves the tested automated accepted-return/replacement journey, not every warehouse role, disposition, stock type or real-user pilot. All owned records and photos remain retained for separate cleanup review. No normal tester scenario is part of this run's cleanup scope. SMTP remains excluded.
