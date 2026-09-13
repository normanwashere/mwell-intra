# WMS Live Signoff: First Operational Journey

Status: **In progress. Not a production signoff.** SMTP is outside this work.

**Latest ecommerce result:** Fresh run `fbceedf7-9ffd-49dd-be36-f1d7ff4f66f3` completed two uninterrupted desktop/mobile journeys on live build `63a52fc`. All 32 checkpoints passed at `2026-09-13T04:42:17Z`. Independent readback confirms two completed/delivered orders, eight units remaining in each isolated bin, one two-unit movement and one delivery audit per order, and one private POD object per order. Desktop/mobile wrong-bin and packing screenshots confirm the released fixes; a separate ten-image proof/timeline crawl completed without page errors or business writes. No physical delivery or human acceptance is claimed. Details: [Ecommerce live evidence](2026-09-13-WMS-ECOMMERCE-LIVE.md). Earlier run `acd6711b` on `75e733b` retains its linked desktop continuation and continuous mobile evidence; it is not rewritten as an uninterrupted run.

**Latest cleanup:** Authorized CLI access is working. The four original department receipt photos remain archived and absent on a fresh UAT check. The older ecommerce batch `acd6711b` now has two archived/deleted photos and zero scoped database rows, verified in a separate post-cleanup query. The earlier Received batch `55b66a58` and latest completed batch `fbceedf7` still require cleanup. See the ecommerce report for exact receipts and recovery history. This supersedes the historical statements below that no ecommerce cleanup has run.

**Inbound preparation:** Run `658aa8b1-a263-441b-8a6f-423327b16862` contains isolated zero-stock PO prerequisites. Two retained browser attempts stopped before uploads or warehouse commands because of test-harness identity/read-call/locator mismatches. Fresh failure readbacks retained the baseline. A later business-read-only diagnostic verified the live receiving deep link, location/bin/date, product lookup and five quantity inputs with no upload or submission. This does not certify receiving, independent inspection or putaway. Those transactions remain open; do not treat the prepared PO as evidence of an exercised procurement approval.

**Latest release:** Application and KB build `63a52fc42d2bdaa2c219640a0b580a5970be9387` is ready in UAT deployment `dpl_JDBT8w9tMZGMJ7WUZASoET1rFNhe`. Public health verification at `2026-09-13T04:35:16.221Z` and the completed transaction run confirmed the same build and UAT database. Six fresh Marketing/Operations/Admin desktop/mobile smoke checks passed. This supersedes the live-build and pending-layout statements in the historical sections below. Release evidence is in `outputs/wms-signoff/sep13-pack-pick-release`; smoke evidence is in `outputs/sep13-pack-pick-release-smoke`.

## September 13 Deployment Follow-up

The layout and KB changes are now live on UAT as `75e733b1aefd16aab831ca3a04f4d7adab2a66c9`, deployment `dpl_3bQvqGS6dFE9nRWTMtnr1YPX1JZQ`. The public health endpoint confirmed this exact build and UAT database at `2026-09-13T03:43:39.901Z`. Evidence: `outputs/wms-signoff/sep13-release/deployment-readiness.json`. Six read-only post-deployment checks passed for Marketing, Operations and Admin at 1440px and 390px, with no recorded page/server errors; results and screenshots are in `outputs/sep13-wms-release-smoke`. The mobile receipt form and desktop Pick & Pack screenshots were visually reviewed. No receipt was submitted in that smoke test.

The final local candidate passed 153 fulfillment tests and 24 browser checks. Cleanup tests now use five tracked minimal synthetic fixtures instead of ignored local reports; 82 cleanup tests passed with those fixtures. The handbook registry/render/release tests passed 93 checks, covering the new source and the current 451 legacy routes. This is source/render verification, not a new certification of historical screenshot evidence.

The first ecommerce batch is **not complete**. Run `55b66a58-a9e9-4866-ac61-27789182d48b` seeded two isolated products and 20 total opening units. Attempt `a07dde76` stopped before any order because the harness incorrectly selected Marketing for ecommerce intake; the existing Operations Associate assignment is the correct actor. Attempt `f1ff4de3` created order `1d1b2dd1-d9be-4159-ad4b-ea43079b72d4`, then the harness rejected a learning-schema startup request. A fresh database query confirmed the exact synthetic order at Received. Neither attempt uploaded evidence or released stock. Do not rerun this manifest as a fresh UI journey or ask testers to ship it.

The harness correction keeps the existing grants, selects Operations Associate for intake/pick/pack and Operations Lead for independent release, and records normal argument-free own-account learner reconciliation separately from read-only calls. It still rejects training submissions, waivers, foreign-user parameters and unreviewed writes. Eighteen offline runner tests now pass, including distinct server-profile labels versus UUID audit identities and a tightly checked continuation boundary. The first batch still contains two products, their locations/bins/opening stock and one Received order with its audit records. The new cleanup planner removes schema-wide writer locks, captures only run-owned rows and checks dependencies before and after deletion; it is not yet executed on these ecommerce batches. Run-specific writers must remain stopped, evidence needs separate API cleanup, and late unconstrained references are not automatically fenced.

The older department results and preparation notes below retain their original build and evidence boundaries. They do not become transaction evidence for this new deployment.

## What We Actually Tested

Live UAT: `mwell-intra-uat.vercel.app`, build `bd309a8b9dce9530111233cc9442f052f0d4ab7e`, database `kkoitlvydytdhlpxhuah`.

The department journey used isolated synthetic products and bins, with 10 opening units per viewport. Opening stock was seeded; it is not receiving, inspection or putaway evidence. The request and approval were submitted with real authenticated Marketing and Operations Lead accounts through the application's public RPCs. Picking, packing and release were performed through the live browser UI at 1440px and 390px.

The same Operations Associate performed picking and packing. A different Operations Lead released the order. These are real server-derived multi-role test accounts, not browser role switches. Automated identities do not count as human pilot participants.

### Original Run Before The Receipt Fix

The table below records the original failure. The fresh post-fix run passed all 30 recorded checks; see the fix and retest results below.

| Stage | Desktop | Mobile | Evidence |
| --- | --- | --- | --- |
| Department request and independent approval | Passed API/readback | Passed API/readback | Request linked to the new fulfillment order |
| Operator sees the linked demand | Passed UI | Passed UI | Exact-reference queue search |
| General employee attempts allocation | Denied correctly | Denied correctly | Order and inventory unchanged |
| Operator allocates and starts picking | Passed UI/readback | Passed UI/readback | Allocated then picking statuses |
| Wrong source bin | Denied in UI | Denied in UI | Order remains picking |
| Correct bin, product and quantity | Passed UI/readback | Passed UI/readback | Two units, exact pick-bin identity and Associate actor |
| Refresh after pick | Passed | Passed | Saved pick remains and packing is available |
| Accountable handover packing | Passed UI/readback | Passed UI/readback | Recipient and generated handover reference |
| Packer attempts release | Denied correctly | Denied correctly | Order and inventory unchanged |
| Different operator releases | Passed UI/readback | Passed UI/readback | Exact-bin stock 10 to 8, one movement of 2 |
| Releasing operator attempts acknowledgment | Denied correctly | Denied correctly | Order and inventory unchanged |
| Original requester uploads acknowledgment proof | **Blocked** | **Blocked** | Storage rejects the required evidence upload |

At the original failure, independent database inspection confirmed both orders were `released`, both requests were `issued`, and neither had an acknowledgment actor. Both had exactly one `fulfillment_release` stock movement from the scanned bin. Release was not mistaken for recipient acceptance. These orders subsequently completed in the post-fix retest.

## Findings And Required Actions

### P1: Recipient Cannot Complete Receipt - Fixed And Retested

The original Marketing requester can open **Acknowledge receipt**, but the evidence bucket's INSERT policy allows operational warehouse roles only. The required image upload is denied and **Confirm receipt** remains disabled. This is an application permission mismatch, not a missing tester step.

Fix: permit an active, authorized recipient to upload only to the acknowledgment evidence path for their eligible released non-shipment order. Keep ownership checks, unrelated-order denial, non-releaser rules and existing operational upload permissions. Do not grant Marketing general warehouse upload access or remove the evidence requirement.

Retest: original requester uploads and submits successfully; evidence survives refresh and is readable by authorized roles; unrelated requester and unrelated upload paths remain denied; request closes; acknowledgment does not post another stock movement. Then repeat the complete journey with fresh records.

Update: migration `warehouse_recipient_ack_evidence_upload` is applied to UAT. The focused post-fix live retest passed eight checks across desktop and mobile: original requester upload/acknowledgment, unrelated requester denial, unknown-order denial and unrelated-purpose denial. Both original orders completed and their requests closed. Owner and Operations Lead downloaded byte-identical private images; stock and movement rows were unchanged by acknowledgment. Evidence: `outputs/wms-signoff/sep13-department-second/ack-retest-2026-09-13T02-27-36-525Z/results.json`. This continuation is not a fresh complete-journey pass. The app build stayed `bd309a8`; the database policy changed separately. An independent reviewer found no pre-apply security blockers; 43 focused migration tests passed.

Fresh post-fix run: **30 checks passed, no failures**, on new desktop and mobile fixtures. Both department journeys reached completed orders and closed requests after actual recipient uploads. Each isolated bin finished at 8 units from an opening 10, with exactly one movement for the 2 released units and no second deduction at acknowledgment. Evidence: `outputs/wms-signoff/sep13-department-postfix/attempt-2026-09-13T02-29-52-573Z/results.json`. This proves this bulk-merchandise department journey; it does not certify every WMS channel, stock type or exception.

### P2: Mobile Success Messages Cover The Pick Form - Fixed In Local Candidate

Rapid allocation and start-picking actions leave two long success notices over the 390px scan form. The screenshot shows the notices covering a substantial part of the bin/product capture area. Page-width checks alone do not detect this.

Fix direction: keep confirmations short and avoid accumulating obsolete success notices while the operator moves to the next task. Preserve error visibility and persistent handover instructions. Validate actual field visibility immediately after successive actions, not only after notices disappear.

Candidate result: allocation and start-picking confirmations now appear on the affected order row. The next confirmation replaces the previous one and opening capture clears the obsolete notice. Failure messages remain visible. The global notification system and other workflows are unchanged. The new browser regression first reproduced two notices covering the form; after the fix, it passed at 1440, 1280, 768, 390, 360 and 320 pixels. Invalid bin submission still reports the missing source scan and does not mutate the memory fixture. Live deployment/retest remains pending.

### P2: Stacked Dialogs And Long References Compete With The Task - Fixed In Local Candidate

Opening acknowledgment from request details leaves the Review request dialog visibly behind a second dialog. The full generated UUID also occupies several heading lines on small screens. This is usable enough to reach the upload control but needs a focused layout review.

Fix direction: present one clearly active work surface while retaining the request context and correct back/focus behavior. Keep full references accessible and copyable without allowing them to dominate the mobile heading. Do not change the transaction sequence.

Candidate result: request review is temporarily removed while its receipt form is open. Cancel or successful confirmation restores the request and appropriate focus. The accessible dialog name keeps the full order reference; the visible heading is kept to one line, with an expandable, copyable full reference in the form. Browser Back and uncertain-response behavior have focused component coverage. The new browser regression and existing Marketing acknowledgment regression passed together: **18 tests across six viewports**, including 1280px dark mode. These are local memory-mode UI tests, not live database evidence or hardware acceptance.

Reviewed captures are under `outputs/wms-signoff/sep13-layout-verified`. Before-fix captures and failures remain under `sep13-layout-before`. An intermediate run exposed a test assumption that the pick submit button should be disabled on an invalid bin. The existing implementation intentionally validates on submit; the final test checks the precise error, retained dialog and unchanged persisted memory data instead. The UI behavior was not changed to satisfy that assumption.

## Evidence And Limits

- Main run: `outputs/wms-signoff/sep13-department-second/attempt-2026-09-13T02-14-51-223Z/results.json`.
- Desktop order: `89561515-0b63-4cc9-901e-a282fa640db9`; request: `48c8f4b9-7d3b-4e93-8fff-49faf832d10f`.
- Mobile order: `1dd8d9d6-9484-4340-9da9-79470735ce92`; request: `9ae80161-8a4c-4c38-aa94-4f597275c571`.
- The first harness attempt had a wrong DOM role and a retry-date issue. A separate negative probe incorrectly expected Marketing allocation to be denied; the configured Marketing role intentionally has reservation permission. Those are test defects, not application defects, and do not earn passing journey credit.
- 49 focused contract, acknowledgment and picked-bin tests passed locally. These complement, but do not replace, live evidence.
- Receiving/putaway, ecommerce delivery, returns/replacement, serialized/bundle stock, packaging consumption, concurrent users, network recovery, remaining roles and a real floor pilot are still open.
- Run-owned fixtures require independently verified cleanup. Tester stock and orders must remain untouched. The cleanup status below is separate from transaction test success.

## Cleanup And Publication Status

- The first harness batch (`cab26bee-3125-4f44-809e-e8bfa5a2fe03`) was removed using manifest-bound SQL with lineage, dependency and evidence guards. A separate query found zero rows in the 11 scoped tables and zero matching Storage objects. Evidence: `outputs/wms-signoff/sep13-department-first/independent-postcleanup.json`. This is scoped verification, not a global zero-residue claim.
- The second and fresh post-fix batches are now cleaned. Their four private receipt photos were downloaded, archived and SHA-256 verified before removal through the Storage API. The guarded database cleanup then removed their exact linked synthetic rows. Independent post-cleanup queries show zero remaining scoped rows and matching Storage objects for both runs. No tester-owned stock or orders were included in the deletion scope.
- Storage cleanup initially could not start because the UAT deployment export had no usable Storage administration key and the CLI session was unauthorized. At the user's request, the official CLI login was refreshed using their signed-in Supabase browser session. The key was retrieved through the official CLI, held only in the cleanup process environment and cleared afterward. No tester delete permission was added, no evidence requirement was relaxed, and Storage metadata was not deleted directly.
- Cleanup evidence: `outputs/wms-signoff/sep13-department-second/storage-verification.json` and `outputs/wms-signoff/sep13-department-postfix/storage-verification.json`, their hash-named archived images, and each run's `independent-postcleanup.json`. All three scoped test batches now have zero-row readbacks. This is not a claim of a global audit of every unrelated or unknown JSON reference in the database.
- The temporary environment export was removed. The cleanup runner refuses to run without its required credentials and explicit apply flag.
- The recipient upload database policy and KB wording are live on UAT. The app and KB deployment is now `75e733b`; the earlier department transaction evidence remains tied to its recorded `bd309a8` build and separately applied policy.
- The UAT migration ledger confirms version `20260913022735`, name `warehouse_recipient_ack_evidence_upload`. The local migration filename matches this applied version; it must not be reapplied under the earlier draft timestamp.
- Cleanup generator regression coverage: 32 local tests passed. The independent live cleanup receipts above provide the separate evidence of actual removal.

The separate Storage cleanup safety suite passed 50 local tests, including compatibility with the archived live rows, wrong-run rejection, partial inventory refusal, archive verification and uncertain-deletion recovery. Live removal is proved by the receipts above, not by those mocked tests. The fulfillment component regression suite passed **150/150**; its saved report is `outputs/wms-signoff/sep13-layout-fulfillment-tests.json`.

## Next Execution Readiness

Independent pre-release review found that allocation/start-picking feedback disappeared when the affected row left a stage-filtered queue. The candidate now keeps one non-overlay confirmation below the filters when that happens, including the order reference. It uses the per-row confirmation otherwise and clears on the next action or opening pick capture. Both regressions failed before the fix. The final local rerun passed **153 fulfillment tests and 24 browser tests** across six widths; reports/captures are `outputs/wms-signoff/sep13-layout-filter-fulfillment-tests.json` and `outputs/wms-signoff/sep13-layout-filter-verified`. Mobile 390px and dark desktop 1280px fallback captures were visually reviewed. These results supersede the earlier candidate counts, not the recorded live transaction evidence.

- The dedicated ecommerce shipment runner has now completed the limited bulk-merchandise shipment journey described at the top of this report. It uses shipment tracking, not department acknowledgment. Its cleanup and held/partial/serialized/concurrency branches remain open; no broader signoff credit is inferred from the passing shipment journey.
- The [warehouse pilot run sheet](2026-09-13-WMS-PILOT-PACK.md) is prepared with participant coverage, concrete tasks, observation fields, device checks and acceptance records. It has no prefilled successes. Named participants and actual observations remain required.
- The Supabase CLI refresh and scoped department cleanup are complete. The remaining external gate is actual pilot participation; no human acceptance has been inferred from the automated work.

The dedicated signoff contract requires explicit persisted checkpoints and reviewed screenshots; old screen-only workflow names do not earn operational signoff credit. Human hardware and pilot gates remain separate.
