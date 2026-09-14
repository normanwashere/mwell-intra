# Warehouse Update - September 14

UAT is on **c79fa8d**, checked at **05:55 UTC**. Please leave marked synthetic audit records and photos in place.

## What's Live

- **Finish review** returns completed receiving practice to the checklist without replaying a receipt.
- Pricing stays read-only, with a permission-gated Product handoff, **Load more products**, unavailable incomplete bundles and corrected **markup** labels.
- Pick-location cards use saved bin codes when the order has no source location.
- Blind counts hide expected balances and variance clues before successful submission.
- Pricing long names now wrap. The CI cleanup helper adds no ordinary-user permissions.

## What We Checked

- **c79 desktop:** Pricing reached **368 of 368 products** without overflow or a remaining Load more button. **Two** bundles, Wellness Starter Kit and Doctor VIP Kit, show **Unavailable**; each is missing all three constituents.
- **ec646b5 desktop:** the saved pick bin displayed correctly. Blind-count feedback stayed hidden before submission; those early inputs were cleared without uploads or submission.
- **c79 desktop:** Logistics submitted a synthetic count. A separate supervisor opened its stored image, added a review note and approved. Stock changed **5 to 4**, with one **-1** movement. The counter's own-review action was unavailable; no direct backend denial probe was run.
- The approved count source fits a measured **390 x 844** mobile view without horizontal overflow. That is a read-only review, not a mobile count transaction pass.
- Earlier evidence retains all-seven learning completion and the Operations handoff's **7 to 5** balance, before this count adjustment. Records and synthetic images remain retained; no physical-count or cleanup claim.

## Still Being Tested

- Finish review's live return to the checklist remains unverified.
- Compact task-audience text and the supervisor header-label correction are candidates, not deployed fixes.
- **CI193 failed preparation** at a SQL source-pin test because of CRLF/LF differences. The strict correction is being reviewed; no green replacement run is claimed. SMTP and full certification remain outside these passes.

[Release details](../releases/2026-09-14-RECEIVING-PRACTICE-CHECKPOINT.md) | [Evidence index](../../outputs/wms-signoff/sep14-isolated-onboarding-observation/index.html)
