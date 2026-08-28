# August 27 WMS Feedback Remediation

Scope: pages 1-5, August 27 section of `wms comments (4).pdf`. Earlier-dated comments are outside this change set.

## Changes

1. Procurement receiving: per-item selection, condition-specific serial scanner, saved per-operator progress, and delivery-note capture with HTTPS-only external links.
2. Event allocations: multi-item entry, Selling/Giveaway purpose, and Marketing reservation access without issue or approval authority.
3. Allocation returns: quarantine-first wording and command, removing the misleading direct-restock option.
4. Returns receiving: multi-item intake with per-item quantities and serials, whole-batch validation, and a stable idempotency key for unchanged retries.
5. Fulfillment: actionable tab counts, View request details before decisions, and zero fulfill-now for individual backorder lines while preserving meaningful overall splits.
6. Receiving recovery: scope evidence to the open PO, preserve unsaved work after failed saves, use current serial state, refresh PO balances and avoid false draft-cleanup errors.
7. Return availability: physical units and quarantine holds are recorded atomically so pending intake does not deduct unrelated available stock; exact Quality acceptance releases only the inspected quantity.

## Validation Boundary

Released to `https://mwell-intra-uat.vercel.app` from application commit `ef22d20`, deployment `dpl_7PxZBKV4qnpb8pcU43VXesp6GM43`. Health verification identifies the UAT Supabase project `kkoitlvydytdhlpxhuah`. Production was not changed.

Live verification: 10 targeted desktop/mobile workflow cases and two Marketing access checks passed. The Marketing assessment was completed normally through the live UI (100%, attempt one), not by inserting completion. Browser saved-progress writes were read back and cleaned up; transaction probes were rolled back. The four 100-unit PO lines remain available to testers. The response report contains screenshots, implementation context and remaining operational acceptance work.

This is a targeted August 27 regression, not a fresh certification of every Intra module. Unit, component, database isolation/concurrency and live UAT desktop/mobile evidence are recorded in the matching remediation report. Real camera optics, four people scanning simultaneously, and production transactions require supervised operational acceptance. No production data should be used to demonstrate these fixes.
