# WMS Live Signoff: First Operational Journey

Status: **In progress. Not a production signoff.** SMTP is outside this work.

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
- The recipient upload database policy is live on UAT. The KB source and standalone manual were updated locally; the KB change has not yet been published in a new app deployment. The app build remains `bd309a8`.
- The UAT migration ledger confirms version `20260913022735`, name `warehouse_recipient_ack_evidence_upload`. The local migration filename matches this applied version; it must not be reapplied under the earlier draft timestamp.
- Cleanup generator regression coverage: 32 local tests passed. The independent live cleanup receipts above provide the separate evidence of actual removal.

The separate Storage cleanup safety suite passed 50 local tests, including compatibility with the archived live rows, wrong-run rejection, partial inventory refusal, archive verification and uncertain-deletion recovery. Live removal is proved by the receipts above, not by those mocked tests. The fulfillment component regression suite passed **150/150**; its saved report is `outputs/wms-signoff/sep13-layout-fulfillment-tests.json`.

## Next Execution Readiness

Independent pre-release review found that allocation/start-picking feedback disappeared when the affected row left a stage-filtered queue. The candidate now keeps one non-overlay confirmation below the filters when that happens, including the order reference. It uses the per-row confirmation otherwise and clears on the next action or opening pick capture. Both regressions failed before the fix. The final local rerun passed **153 fulfillment tests and 24 browser tests** across six widths; reports/captures are `outputs/wms-signoff/sep13-layout-filter-fulfillment-tests.json` and `outputs/wms-signoff/sep13-layout-filter-verified`. Mobile 390px and dark desktop 1280px fallback captures were visually reviewed. These results supersede the earlier candidate counts, not the recorded live transaction evidence.

- A dedicated ecommerce shipment runner is prepared in `scripts/qa/wms-ecommerce-signoff-live.mjs`; 14 offline harness tests passed. It checks UI intake through actual shipment delivery, failed-delivery recovery, idempotency, inventory reconciliation and private POD download hashes. It does not reuse department acknowledgment. Live execution, reviewed screenshots, its separate cleanup, and the additional held/partial/serialized/concurrency branches remain pending. No ecommerce fixtures were seeded or transactions run in this continuation.
- The [warehouse pilot run sheet](2026-09-13-WMS-PILOT-PACK.md) is prepared with participant coverage, concrete tasks, observation fields, device checks and acceptance records. It has no prefilled successes. Named participants and actual observations remain required.
- The Supabase CLI refresh and scoped department cleanup are complete. The remaining external gate is actual pilot participation; no human acceptance has been inferred from the automated work.

The dedicated signoff contract requires explicit persisted checkpoints and reviewed screenshots; old screen-only workflow names do not earn operational signoff credit. Human hardware and pilot gates remain separate.
