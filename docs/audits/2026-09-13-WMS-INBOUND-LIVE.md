# Receiving To Putaway - September 13

Status: **Limited live journey completed. Visual follow-up and scoped cleanup remain open. Not a full WMS signoff.**

## What Passed

Live UAT build `63a52fc42d2bdaa2c219640a0b580a5970be9387`, project `kkoitlvydytdhlpxhuah`. Run `4f486cb0-035c-4599-9a6b-bece2440ebc8` finished at `2026-09-13T06:29:55.079Z`.

Two isolated, nonserialized merchandise products started with zero stock. Each had a prepared issued PO for seven units. Operations Associate received the goods through the live form, an independent Operations Lead accepted the inspection with a separate private photo, and the Associate put the stock in its destination bin.

| Persisted checkpoint | Desktop 1440px | Mobile 390px |
| --- | --- | --- |
| Opening stock | 0 | 0 |
| Receipt | 7 in staging, pending inspection, active hold | Same |
| Transfer before inspection | Denied; stock and movement count unchanged | Same |
| Independent inspection | Accepted, 7 available, hold released | Same |
| Putaway | 7 in destination, 0 in staging | Same |
| Final movements | One receipt and one transfer | Same |

Parent verification reran reconciliation and checked all four archived evidence files. A separate UAT database query at `2026-09-13T06:33:37.411242Z` confirmed accepted receipts, actual delivery date `2026-09-13`, released holds, different receiver/inspector identities, and one receipt plus one transfer movement per product. A separate stock query confirmed seven destination units and zero staging units for both products.

## Evidence Boundaries

Evidence base: `outputs/wms-signoff/sep13-inbound-full-live`.

- Original `live-attempt/report.json` stopped after the desktop receipt and held-transfer denial because a linked CLI verification call failed. No inspection was submitted in that attempt. It is retained as a failed attempt, not relabeled as passing.
- `live-attempt-after-receipt/report.json` verifies the original report SHA-256, exact persisted state, original evidence object and downloaded bytes before continuing. It does not submit the receipt again. Desktop is a linked continuation; mobile is uninterrupted.
- Original report SHA-256: `9aa6aa3602a20d1fe4af1e284baa328a1b41f75cf24d5ec42dbedf96c01505bc`.
- Desktop receipt: `rcpt-7188f847da3040bca65e12a3bbedb925`; mobile receipt: `rcpt-dc1b174f691945e683440b7ae3669694`.
- Four actual private uploads, owner downloads and hash-named local PNG archives are recorded in the final report. They are synthetic evidence, not physical-delivery or human-inspection proof.
- The test PO was seeded as an issued prerequisite. Procurement approval was not exercised. Barcode entry was manual; physical camera/scanner behavior was not tested.
- The live runner reports `complete: true` and `liveCertified: false`. Reconciliation alone does not satisfy visual, cleanup, hardware and human acceptance gates.

## Visual Review

Assistant review of the desktop and mobile pre-submit screens confirms visible task headings and submit actions, readable quantities, and mobile wrapping without page-width overflow. The mobile putaway result displays a success message and resets the form with its submit action disabled. Long synthetic identifiers make these forms dense; no broad ergonomic signoff is inferred.

**P2 - Inspection evidence cannot be reviewed at full size before submission. Local candidate fixed; not deployed.** The live uploaded thumbnail crops the image and has no full-size preview. The candidate reuses the existing private-image lightbox with an uncropped thumbnail and keyboard/touch opening. Closing restores the unsent inspection form; preview does not upload, remove or submit evidence. Parent verification passed 30 focused component tests and four offline browser cases at 1440px/390px with portrait and landscape images. Selected screenshots were visually reviewed. Browser artifacts: `outputs/evidence-capture-preview/2026-09-13T06-38-07-913Z`. These are isolated real-component tests with no backend traffic; private transport is mocked in unit tests and still needs post-release live verification.

**Evidence gap - Post-inspection loading capture.** The desktop `inspection-persisted-viewport.png` was captured while Quality was loading. It does not prove the settled completed-inspection screen. Preserve it and add a separate read-only settled-state capture rather than replacing or relabeling the original.

## Remaining Work

Finish the supplemental visual review, then archive-verify and remove only this batch's evidence and exact synthetic database rows using separately reviewed cleanup. The earlier zero-stock batch `658aa8b1` also remains. Tester-owned scenarios are outside these scopes.

Damaged, short, excess, unidentified, partial and serialized receipt paths, broader independent-role and recovery coverage, physical returns, real hardware and the named-user floor pilot remain separate requirements. SMTP stays out of scope.
