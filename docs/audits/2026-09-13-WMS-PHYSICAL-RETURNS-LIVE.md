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

The runner and its tests are being corrected with a JSON-safe comparison and an explicitly pinned continuation from this pre-return boundary. Recreating source orders or general partial-return replay is not authorized by that continuation. The failed report will not be edited or relabeled as a pass.

## Status

Physical intake, pre-submit image preview, Quality disposition, relocation, replacement and closure are not yet live-certified by this run. All owned records and photos are retained pending completion and separate cleanup review. No normal tester scenario is part of this run's cleanup scope. SMTP remains excluded.
