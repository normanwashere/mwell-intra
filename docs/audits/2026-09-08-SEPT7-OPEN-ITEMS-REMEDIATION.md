# September 7 Open Items Remediation

Target: UAT only (`mwell-intra-uat.vercel.app`, Supabase `kkoitlvydytdhlpxhuah`). All four software items below passed the focused retest. Final viewer verification ran against `f01b21831b85db49f36e51cad351848fcea282a1`. This is not a whole-app or human-pilot certification.

## Deployment

- Revision `86b5bc81f5d3bccfd820933b6a20f11b9c05022e` deployed from a clean committed-source archive.
- Vercel deployment `dpl_DFE23pN11pF58gxKTG4Kj411gtFa` promoted to UAT.
- Public health at 2026-09-08 04:39 UTC confirmed the exact revision, UAT environment, expected Supabase project, reachable database and HTTP 200 stylesheet.
- All three forward migrations applied to UAT only: requester-name projection, private registered evidence access, actual receipt delivery date. Installed poster readback confirms the date helper in both legacy and breakdown paths.
- Production app/database were not changed. No historical dates or evidence were rewritten.
- Follow-up key-format fix: `cbc0d9debe90b6eb7315ccf53489c21dc3b3b48d`, deployment `dpl_7vdkvdbp118gD83mFaJEBC96cHCH`, promoted and exact public health verified at 04:50:40 UTC. Only unsafe evidence-reference segments changed to safe opaque identifiers; valid receiving paths and UI record-generation guards remain intact. An initial health request during propagation returned the preceding revision; subsequent exact verification passed before the inspection retry.
- History/gallery revision `4459b4dc07e68b528f269453bd2060396c209038`, deployment `dpl_AvdZynqHxDMU3e19WkmxaxLE3shj`, promoted and exact UAT health verified at 05:08:32 UTC. Readback passed; main's desktop screenshot inspection then caught a tall-photo viewport overflow, so visual acceptance remained open for the explicit-height follow-up.
- Final viewer revision `f01b21831b85db49f36e51cad351848fcea282a1`, deployment `dpl_6Mv5fe4FgqGr1UVbjAkiDS2xNgzx`, promoted and exact UAT health verified at 05:16:32 UTC. The viewer uses viewport-based maximum dimensions and a 44px close target. Nine focused gallery/inspection tests passed independently again before deployment.

## Automated Verification

- Independent requester SQL tests: 5 passed; lookup matches the existing request-row read predicate and does not grant profile-directory access.
- Independent final Storage SQL tests: 25 passed, including registered owner deletion denial, unrelated-user/vendor denial and source-RLS restrictions.
- Independent governed receipt SQL suite: 26 passed, including new date validation, persisted date, old exact replay and atomic invalid-input rejection.
- Broader Quality/Returns/Fulfillment evidence UI checks: 48 passed.
- KB content/validation: 88 passed. Offline handbook generator/guide suites: 79 passed. Generated handbook freshness and shell TypeScript passed.
- Owning-agent focused checks: 58 evidence tests, 57 receiving UI tests, 101 data-kit tests and 23 product-detail tests passed. These suites overlap; counts are not added into a whole-app certification total.
- Vercel optimized build and TypeScript passed.
- Final follow-up verification: 48 history/receiving/returns tests, 15 gallery/capture/completed-inspection tests, seven KB guidance tests and warehouse TypeScript passed independently. These overlap the earlier suites.

## Acceptance Gates

| Item | Required behavior | Required evidence | Status |
| --- | --- | --- | --- |
| Requester identity | Authorized request reviewers see the requester display name without broader profile access. Unrelated users cannot enumerate names. | Scoped projection positive/negative tests and cross-role UAT screenshot. | Passed focused live and SQL checks |
| Mobile metadata | Long product attributes and identifiers remain readable without horizontal clipping; quantity remains visible. | Long-value regression plus desktop/mobile rendered screenshots. | Passed focused desktop/mobile checks |
| Actual delivery date | Governed receiving captures the actual calendar date, validates it and persists it on the receipt; it is not replaced by expected arrival or posting time. | UI validation, command/persistence regression, UAT receipt readback. | Passed actual live receipt and readback |
| Durable evidence | Authenticated live capture stores private objects, persists their paths, and opens them after reload for authorized handover roles. Failed uploads do not become inline-success evidence. | Upload/retry tests, storage RLS positive/negative checks, real UAT upload and independent readback. | Passed live upload, saved-path readback and desktop/mobile app viewers |

## Data Protection

Preserve all six shared tester POs and their current progress. Use only the separately labelled VERIFY records for controlled transactions. Do not backfill unknown historical dates, invent physical inspection evidence, or reset completed stock movements.

## Live Retest Progress

The Associate submitted one VERIFY Jacket S receipt for 20 units: `rcpt-5c0cc09c00cb4560af1b1ec96abb3486`. Independent readback confirms actual delivery `2026-09-07`, posting `2026-09-08T04:41:42.655062Z`, and a private PNG object of 63,518 bytes owned by that Associate. The saved receipt contains its object path, not inline base64. Main visually reviewed the desktop/mobile date-field screenshots.

Inspection upload initially returned HTTP 400 before any inspection command; the inspection was still pending at that point. This exposed an object-path issue hidden by the former inline fallback. The subsequent key-format correction and successful retry are recorded below. The committed receipt was not retried. Initial selector-only harness failures and this failed upload remain preserved under `outputs/sep08-open-items`, separate from successful results.

The diagnostic returned `InvalidKey` for the JSON-derived inspection reference. The follow-up patch maps unsafe segments to opaque UUID-based segments while preserving safe prefixes. Twenty-one focused transport/race tests passed independently, including a storage-key rejecting mock and unchanged receiving references. The final deployed inspection retest is tracked separately below.

On `cbc0d9d`, inspection `2f15a54e-e362-4eb2-8b63-638c02058c99` accepted 20 units under the independent Operations Lead. The saved path is `inspection/ref-a64ea74d-ea44-4791-bfd0-3eb981c8047a/0/fbe0ea51-5f90-4a02-a2a7-200cf0b72c37.png`; independent Storage readback confirms the Lead owns the 63,518-byte PNG. Authorized native-image readback returned HTTP 200 and the original SHA-256, but this was not yet an in-app completed-inspection gallery check.

The browser readback exposed two related UI gaps: Recent receipts reversed the server's descending order and hid the new record, and completed inspection rows had no saved-evidence viewer. Returns used the same reversal. Revision `4459b4dc07e68b528f269453bd2060396c209038` corrects the ordering and adds the completed-inspection gallery; no repeat transaction is required. The gallery test also exposed nested interactive markup in its existing thumbnail lightbox. The corrected portal supports Close, Escape and focus restoration without nested buttons. Final deployed screenshots are recorded separately after promotion.

Requester-name and long-metadata browser checks passed on revision `86b5bc8` for both Operations personas at desktop/mobile widths. Main opened desktop/mobile request-review screenshots showing the Marketing requester name and mobile product screenshots showing complete wrapped purpose/cost values and quantity 990. The two-file `cbc0d9d` follow-up does not modify these screens.

Installed read-only database persona probes confirmed that the Associate and independent Lead can read the exact registered receipt object, while Employee, Vendor and anonymous personas cannot. No delete was executed. See `outputs/sep08-evidence-storage/installed-uat-verification.md`; these are SQL policy checks, not a substitute for the pending browser image-readback check.

## Root Cause Identified

The evidence capture component called the repository's configuration-based `resolveDataSource()` without supplying configuration. That resolves to memory mode even when the application has an authenticated Supabase repository. Tests that mocked the helper to return Supabase did not exercise this integration mismatch. The replacement must use the actual authenticated session and fail closed when a live client is unavailable.

The private evidence bucket now has a bounded handover policy: an independent authorized reviewer can read registered evidence without arbitrary access to other users' unregistered objects.

## Final Screenshot Review

On `f01b218`, all four final read-only viewer runs passed with exact revision checks before and after. The Operations Lead reopened the Associate's saved receipt photo and the completed inspection's own photo through the actual app, not a replacement image page. Signed Storage delivery returned HTTP 200. The original image dimensions are 1200 x 1100. Main opened and reviewed the final desktop and mobile screenshots.

- `outputs/sep08-open-items/receipt-image-1440-1788844624310`: latest receipt first, actual date 2026-09-07 and complete saved-photo viewer after reload.
- `outputs/sep08-open-items/receipt-image-390-1788844640507`: corresponding mobile readback.
- `outputs/sep08-open-items/completed-gallery-1440-1788844670512`: exact completed inspection, loaded thumbnail, full photo, Close/reopen and Escape. Image fits y=16..884 within the 900px viewport.
- `outputs/sep08-open-items/completed-gallery-390-1788844683535`: corresponding mobile viewer; image fits x=16..374 within the 390px viewport.

The earlier `4459b4d` gallery runs passed functional loading but failed main's desktop visual acceptance; they are retained as historical evidence, not used as the final visual pass. Final read-only harness runs block learning-assignment reconciliation to prevent unrelated writes; this focused test does not certify onboarding. No receipt or inspection was repeated during viewer retests.

The six shared tester POs retained 300 units each, zero received in the independent post-transaction check: the SEP07 pair plus SEP08 TESTER1 and TESTER2 pairs. Only the separate VERIFY Jacket S line received/accepted 20 units in this follow-up. Existing tester inventory and historical dates were not reset.

Final browser report: [actual-app viewer verification](../../outputs/sep08-open-items/FINAL-V4-REPORT.md). Hash-bound capture manifest: `outputs/sep08-open-items/final-ui-handoff-v4.json`. Updated receiving and evidence instructions are in the KB and [standalone handbook](../manual/index.html).

## Coverage Boundaries

Synthetic browser evidence can verify file upload, persistence, authorization and rendered preview. It cannot certify a physical delivery, camera hardware, actual signature or human usability pilot. These remain distinct from the software defects above.

The uploaded PNG is a reused, clearly labelled synthetic byte fixture whose printed text references the earlier tumbler scenario. Its use on the jacket verification receipt/inspection tests transport and persistence, not document-to-item semantic matching or real jacket delivery. Historical evidence was not relabelled or replaced to conceal that distinction.
