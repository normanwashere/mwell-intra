# Warehouse Update - September 14

UAT is on **ec646b5**, checked at **05:38 UTC**. Please leave marked synthetic audit records in place.

## What's Live

- **Finish review** returns completed receiving practice to the checklist without replaying a receipt.
- Pricing stays read-only, with a permission-gated Product handoff, **Load more products**, unavailable incomplete bundles and corrected **markup** labels.
- Pick-location cards use saved bin codes when the order has no source location.
- Blind counts hide expected balances and variance clues before successful submission.
- The reviewed service-role CI cleanup helper was applied. No ordinary-user permissions were added.

## What We Checked

- On this build, entering a matching blind count of **5** hid expected quantity, variance and balanced feedback. Submit stayed disabled without evidence. No photo or count was submitted.
- Pricing desktop reached **368 of 368 products**, with no Load more button left. The unauthorized Product link stayed hidden, owner guidance appeared, actual margin stayed **37%**, and all three incomplete bundles showed **Unavailable**.
- Earlier builds retain all-seven learning completion and the synthetic Operations-to-Warehouse handoff, with stock **7 to 5**. Those are not fresh runs on this build; completed records and the synthetic receipt image remain retained.
- Clean-source documentation checks passed. The final frozen card rerun passed **49 tests**; the earlier full Warehouse run had **1,134 passes and one changed-source failure**, not a clean full pass.

## Still Being Tested

- Finish review's live return to the checklist and the new card display still need verification.
- Pricing's desktop screenshots exposed long-name table overflow; a separate fix is underway.
- The viewport-switch tool did not resize the browser. **No new-build mobile pass is claimed.**
- CI 192 remains latest and red after stale handbook HTML stopped later tests. Documentation is corrected, but vendor preflight, remaining journeys and full certification are still open. SMTP is outside this work.

[Release details](../releases/2026-09-14-RECEIVING-PRACTICE-CHECKPOINT.md) | [Retained handoff evidence](../../outputs/wms-signoff/sep14-isolated-onboarding-observation/operations-multirole-handoff-live.json)
