# WMS Feedback Release

**Release date:** August 21, 2026  
**Application commit:** `f88c9916c253546ae6960bd19ffd608b99fdd791`  
**Environment:** Mwell Intra UAT  
**Source:** Warehouse stakeholder feedback in `wms comments (1).pdf`

## User-facing changes

- Product-owned selling price is visible and read-only in Warehouse.
- Bundle orders are explicitly identified and receive one generated set ID per set.
- Pick & Pack requires the displayed rack/bin scan before serialized unit scans.
- Ecommerce CSV import and export cover controlled channel, payment, customer, address, product, dispatch, handover, and audit fields.
- Returns support camera/manual serial capture and automatic original-release matching.
- Pending Fulfillment and Allocation work is visible in desktop and mobile navigation.
- Receiving guidance, validation, serial layout, and mobile actions were refined.
- Department requests, delivery handover references, proof upload, and delivery tracking permissions were completed.
- The standalone handbook and maintained source manuals now describe these released behaviors.

## Verification

- Lint, typecheck, tests, build, and 80 documentation-content checks passed.
- Responsive visual checks passed at 1440, 1280, 768, 390, 360, and 320 pixels.
- Live UAT route checks passed for all personas and viewports.
- Live mobile governed write, readback, handoff, and cleanup passed.
- Desktop vendor-invitation delivery remains blocked by the built-in Supabase SMTP hourly quota. Custom SMTP is required for launch certification.

## Documentation rule

Operational releases must update the standalone handbook, both maintained manuals, the technical and functional specification, the training and handover source, and a dated release note. CI creates a commit-bound documentation manifest and bundles current live audit screenshots. Missing documentation blocks UAT certification and production deployment.
