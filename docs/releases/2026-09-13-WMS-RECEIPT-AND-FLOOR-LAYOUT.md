# WMS Receipt And Floor Layout - September 13, 2026

Status: UAT receipt-upload migration applied; application layout candidate awaiting deployment and live retest.

## What Changed

- Eligible department requesters can upload receipt evidence for their released handover without warehouse execution permissions. The releasing person still cannot acknowledge their own release.
- Allocation and start-picking confirmations stay on the affected order, keeping the scan form clear. If that order leaves the selected filter, one confirmation remains below the filters with its reference.
- Opening receipt capture temporarily closes request review. Cancel or successful confirmation returns to that request with focus restored.
- The full order reference remains available in an expandable, copyable section without making the mobile dialog heading excessively tall.

The layout changes do not change the workflow, required evidence, approval order, stock movements or permissions. The receipt-upload permission correction is a separate, narrowly scoped database change.

## Evidence And Limits

- Live pre-layout department journey: 30 checks completed, with persisted stock and request/order reconciliation.
- Final local layout regression: 153 fulfillment component tests and 24 browser tests across six widths, including dark mode and filtered-queue confirmation.
- KB validation: 81 checks passed. Standalone handbook regenerated from maintained sources.
- Three synthetic department batches independently cleaned; four receipt photos archived and hash-verified before removal. Existing tester data was outside the cleanup scope.

The application candidate is not yet live-certified. Ecommerce, other warehouse branches, real hardware and actual participant acceptance remain open. SMTP is excluded. See the [live readout](../audits/2026-09-13-WMS-LIVE-READOUT.md) and [pilot pack](../audits/2026-09-13-WMS-PILOT-PACK.md).
