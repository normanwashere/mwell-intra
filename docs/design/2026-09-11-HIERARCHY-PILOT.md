# Working hierarchy visual pilot

## Release boundary

Three-screen design preview only: Pick & Pack, My Work, and purchase-order detail.
Not pushed to the live UAT alias. No database migration or operational write was made.

- Baseline UAT commit: `343b3725814f962c70e517f32cf336258f41e74f`.
- Preview app commit: `c3614d22494edda0680dc46a5a9b077c346fe525`.
- Protected preview: https://mwell-intra-ae73apifu-normans-projects-d718ecb1.vercel.app
- Local comparison: `outputs/sep11-hierarchy-preview/index.html`.

## Design changes

Neutral section bands distinguish controls from white working surfaces. Selected views use a solid blue treatment. Dark mode uses distinct charcoal shades, preserving existing warning and status colors. The PO record uses a wider desktop working area.

Pick & Pack department handoff and event-sales summary are available inside Queue tools. Existing record-level sales values remain. Commands, eligibility, fields, permissions, and transaction handlers are unchanged.

## Verification

- Work: 55 tests passed.
- Procurement: 309 tests passed.
- Warehouse fulfillment: 142 tests passed; after the final disclosure adjustment, 47 focused page/navigation tests passed again.
- Two visual-scope contract tests passed.
- Remote preview production build and TypeScript checks passed.
- Three authenticated screens checked at 1440 and 390 pixels, with light/dark captures: 12 before and 12 after images.
- Six final browser cases passed authenticated reads, page-width checks, and applicable search, disclosure, history, and section-link checks. Operational submissions were blocked during capture.
- Comparison viewer checks passed for all images, screen selection, viewport, theme, and enlarged after-only view.
- Live UAT health was rechecked and still reported the baseline commit.

First Pick & Pack order position improved from 785 to 561 pixels on desktop and from 590 to 583 pixels on mobile. An initial candidate added a mobile disclosure row above the queue; visual review caught that regression, and the final version places the disclosure within Queue tools instead.

One mobile capture recorded a pre-login 401 from assignment resolution. Authenticated navigation completed successfully; this observation is retained in the results rather than counted as a successful authenticated call.

## Limits and next decision

This is a visual pilot, not full transaction certification or an all-role audit. Screenshot review does not establish real-user usability. Review the comparison before extending the treatment to other modules. Update published training/manual screenshots when an approved version is promoted, not while the live app still has the previous design.
