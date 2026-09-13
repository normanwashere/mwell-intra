# Warehouse Candidate Verification - September 13

Status: candidate checks below are retained as history. The application is now deployed in `0079161`; see the [release review](2026-09-13-WMS-RETURN-VISIBILITY-RELEASE.md) for live evidence and remaining limits. Not fully certified.

## Confirmed Cleanup

The four original department receipt photos were archived and removed using the approved Storage cleanup. A fresh independent UAT query at `2026-09-13T07:08:02.70239Z` found zero remaining objects for the four exact paths recorded in:

- `outputs/wms-signoff/sep13-department-second/storage-verification.json`
- `outputs/wms-signoff/sep13-department-postfix/storage-verification.json`

This confirmation covers those four objects, not every synthetic object in UAT. Newer receiving fixtures and the earlier Received ecommerce order remain retained. The Received-only cleanup helper passed independent review, but its required operational no-write window has not been established. No absence or isolation attestation was fabricated.

## Candidate Checks

Parent verification on the working candidate completed:

| Check | Result |
| --- | --- |
| Returns, Fulfillment, Storage Areas and EvidenceCapture component tests | 92 passed |
| Return-lineage migration, ecommerce cleanup/Storage cleanup and handbook-guide tests | 268 passed |
| Knowledge content | 60 passed |
| Return repository safety | 27 passed |
| Handbook generation and catalog tests | 50 passed |
| Shell production build, including TypeScript | Passed |
| Generated standalone handbook freshness | Passed, 42 source documents |
| Storage Areas offline browser layout | Passed at 1440, 768, 390 and 320px |

These are local tests, not 497 live business transactions. The existing full WMS contract remains unchanged and unsatisfied.

Parent visually reviewed desktop/mobile Storage Areas captures from `outputs/wms-signoff/storage-area-layout/2026-09-13T07-04-32-264Z`. Full bin codes and labels wrap; zones occupy a separate secondary row; no identity is reduced to an ellipsis. This isolated harness uses a mocked store and system-font fallback. Independent application-font evidence is retained in the `2026-09-13T07-00-54-131Z` sibling folder.

Parent also reviewed the updated desktop return-case action-spacing screenshot under `outputs/wms-signoff/sep13-return-lineage-spacing-after`. The physical-intake link and resolution button are separated. The agent's eight browser tests and independent 72-test UI rerun cover navigation, existing drafts, linked uncertain-command recovery and action spacing; those are separate reviewed reports, not additional parent live runs.

## Release Boundaries

The candidate adds optional original-order/customer-case links to physical return intake without changing existing Quality, hold-release or customer-resolution authority. It also adds full-size pre-submit photo preview and fixes long bin-label layout.

The return migration was subsequently applied to UAT as `20260913071110_customer_return_intake_lineage`. Readback at `2026-09-13T07:12:22.314687Z` confirmed both nullable columns, both indexes and the private validator. The public `record_return_v2` definition hash and grants are unchanged; the retained implementation and private validator remain owner-only with an empty search path. The returns read policy is unchanged. Security advisors reported the same 13 existing informational no-policy notices before and after, with no new notice. The local filename now matches the actual recorded migration version, and all 14 migration tests passed again. App deployment and live checks are next; KB and handbook wording remains explicitly marked as pending release until then.

Next: release the reviewed candidate, verify its changed controls on live UAT, execute the physical-return journey with persisted stock and independent handover checks, and complete the remaining strict WMS coverage. SMTP stays excluded. Actual hardware and named-user pilot acceptance remain separate and cannot be supplied by automated accounts.
