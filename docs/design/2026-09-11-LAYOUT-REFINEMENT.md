# Desktop layout and dialog refinement

## Status

Preview only. App candidate `5c6c0c1` is deployed at https://mwell-intra-bx0n3l7o8-normans-projects-d718ecb1.vercel.app (Vercel authentication required). Live UAT was checked and remains at `343b3725814f962c70e517f32cf336258f41e74f`. No branch push or production promotion was performed.

Screenshot gallery: `outputs/sep11-hierarchy-preview/layout.html`. Final browser evidence: `outputs/sep11-hierarchy-preview/layout-refined/results.json`.

## What changed

- Both desktop sidebars now stay in the viewport. Their navigation scrolls independently, while the logo and footer remain reachable. Existing hide/show preferences and mobile navigation are retained.
- My Work uses compact desktop rows with aligned request, responsibility and action columns. Mobile retains stacked records. Empty follow-ups take less space but still report their state.
- Shared Sheet dialogs have a distinct header, stronger section separation, a clearly bounded scrolling body and contrasting action footer. Focus management, dismissal and existing submit controls are unchanged.
- Order details use a 960px maximum desktop width instead of 1152px. Status and copy controls share one area. Summary and metadata sit together, replacement/customer sections are grouped, and the shipment timeline spans the record width.
- New-order intake uses the same bounded desktop width for its longer fields. All original fields remain in their original form sequence, with clearer section headings and the existing pinned submit action.
- PO amendment inputs and evidence are grouped into two desktop columns, with input baselines aligned even when a label wraps. The form stacks on mobile.

## Verification

- Warehouse: 287 tests across 37 files passed, covering fulfillment, receiving components, intake drafts, shared dialog accessibility, evidence interactions and navigation.
- Procurement: 314 tests across 45 files passed.
- My Work: 55 tests across seven files passed.
- UI typecheck and final Vercel build/TypeScript checks passed.
- Six final authenticated browser cases passed: Operations Associate, Employee and Procurement Lead, each at 1440x1000 and 390x844.
- Browser assertions cover page overflow, sidebar bounds after scrolling, hide/show persistence, copy reference/link readback, list return position, PO filter/sort context, dialog horizontal fit, Escape/focus return, footer separation, single-line request actions, amendment alignment and timeline width.
- All 20 gallery image selections and their full-size links were checked. Desktop/mobile screenshots were visually inspected, including light/dark order details, intake, lower dialog sections, My Work and PO amendment layout.

## Review corrections

Screenshot review caught a wrapped desktop action label, narrow order intake, an unnecessary copy-toolbar row, misaligned amendment inputs and a half-width timeline. These were corrected before the final browser pass.

The stricter PO check initially used an exact label query that did not match the select's accessible naming. It now uses the select role and observed name prefix; alignment assertions remain strict. Theme capture originally assumed the suite shell supported Warehouse's storage listener. Final captures use the visible switch for page themes and Warehouse's supported cross-tab preference listener while its sheet is open. Earlier attempts remain separate from final evidence.

## Boundaries

No schema, RLS, permission, approval, stock rule, validation rule or transaction handler was changed. The screenshot harness blocked operational writes. Existing handovers, order fields, evidence, linked records and save actions remain in place.

This is focused layout validation, not a new all-role transaction certification. Shared Sheet consumers outside the sampled screens still need broader visual coverage before a suite-wide release claim. The isolated preview does not certify notification or legal-delivery infrastructure. Published KB/manual content remains aligned to live UAT until these changes are promoted; this note documents the preview.
