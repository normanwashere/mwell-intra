# September 7 Feedback UAT Deployment

- Verified public target: https://mwell-intra-uat.vercel.app
- Deployed commit: `d9b1edb0203aad1f0b045d571e59395f79f4a4ca`.
- Vercel deployment: `dpl_HUK3GeC9d95BH2GS7DRRrRGDjZwT`, Ready.
- Deployment URL: https://mwell-intra-bamcjxxwp-normans-projects-d718ecb1.vercel.app
- Public health verified September 8, 2026, 02:35 UTC: exact commit, `appEnv=uat`, Supabase `kkoitlvydytdhlpxhuah` reachable, stylesheet HTTP 200.
- Source: clean Git archive of the committed candidate. Unrelated learning drafts, telemetry migration and earlier uncommitted audits excluded.
- Remote production-mode build and TypeScript passed; the production-mode build belongs to the UAT Vercel project, not the production Intra app.
- Public alias promoted after candidate health verification. Production app/database untouched.

## Verification

Combined changed-screen tests: eight files, 127 tests passed. Adapter bundle/retry tests: 40 passed. Seed SQL tests: 11 passed, plus actual-UAT rollback, application and Operations-role readback. KB content/provenance: 81 passed; KB flow: four passed. Warehouse and shell type checks passed. These groups overlap other earlier runs and are not summed into a unique test total.

Both new POs are present with four mapped lines and zero received quantity. Existing product, PO and line fingerprints matched before and after seed. The fixtures intentionally have no received or released stock so testers can execute the requested journey themselves.

The handbook and KB clarification ship in this revision. See [feedback response](2026-09-08-SEPT7-WMS-FEEDBACK-RESPONSE.md) and [earlier-date regression trace](2026-09-08-EARLIER-WMS-REGRESSION.md).

Live browser evidence is separate from build/health and component test results. The initial baseline capture encountered an incorrect test locator for the inventory container (a generic labelled container, not an ARIA list). That failure must not be reported as a missing application feature or a passing browser case. Retain the corrected commit-bound capture report under `outputs/sep08-merch-live`.

## Live follow-up

The corrected merchandise run completed six cases on this exact deployed revision: Operations Associate, Operations Lead and Marketing at 1440px and 390px. It verified PO lines, barcode rejection/verification and preserved quantities, product identity and zero pre-receipt availability. No receipt, issue or request was submitted. Retained initial failures include the inventory locator, adjacent-text whitespace and two source-verified read-only RPCs omitted from the test allowlist; these were harness issues, not passing cases or confirmed app defects.

Main's additional four live checks passed at 1440px and 390px: Operations Associate's generated/editable order reference and Operations Lead's serialized relocation scanner rejecting an unknown serial while Move stock remained disabled. Four original screenshots were opened and visually reviewed; labels, errors and action controls were readable without incoherent overlap. Evidence: `outputs/sep08-carryover-live-v2/results.json`. The first attempt incorrectly expected the order-intake action on the Lead role and remains preserved separately. No role was changed to force a pass.

These are read-only form interactions using manual scanner input, not physical-camera certification or completed receipt-to-release transactions. Browser contexts were closed after the runs. Seeded merchandise remains for the tester to receive, inspect and release.
