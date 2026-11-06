# Tester Handoff

Use the [current release manifest](release-status.json) and confirm deployed UAT `dd9048e` before running an assigned case. The [September tester pack](../2026-09-22/testers.md) is historical guidance; do not copy its evidence into current results. Scoped engineering checks below do not fill the human checklist: all 90 WMS result rows remain **PENDING**.

The update is now on UAT. Get your case letters, exact fresh record links and stock baseline from the coordinator, then work with the named independent Lead/Quality partner. Use the actual work device, refresh the same record and record what happened. Stop on an uncertain save; do not retry, clear storage or fix stock yourself. Engineering QA owns the 520-cell interruption/replay appendix, not the Warehouse tester.

Same-version evidence: privacy4 passed; return balance showed0 of2 at1440/390 with submit disabled and no business writes; Product/export screens passed9 automated checks at1440/390/320 with six distinct images visually reviewed and identical cold/reload pairs hash-confirmed. The return harness blocked normal Learning synchronization, so it is not an unintercepted startup or completed return. No export was requested. G02 is BLOCKED by missing first-putaway bridge; conversion was not run; G01 remains blocked by unavailable Auth administration. Physical-device and departmental acceptance remain separate. Earlier `0b7964e` bundle/export evidence stays historical.

The [November 6 readiness update](../../releases/2026-11-06-RELEASE-READINESS.md) supplies the deployment/evidence trace, not a blanket test-window announcement. The coordinator supplies the approved fresh fixtures, independent actors, configured delivery requirements and test window. Existing safe isolated-test approval remains valid within its scope. Record each variant independently; missing access, data or evidence is Blocked, not Pass.

Open or refresh the app while online so the updated worker can activate and purge old private CacheStorage. Do not clear all browser storage or uninstall the PWA: queued work must survive under its original account. An old offline-only client cannot receive the update, so no retroactive offline purge is claimed.

| Area / finding | Required acceptance evidence |
| --- | --- |
| Public-only cache / QA4-001 | With synthetic private data, test logout, account/access change, online denial then offline, and upgrade from an old worker. No private response reappears; queued commands remain actor-scoped and intact. |
| API denial / QA4-002 | Anonymous protected GET returns JSON 401 and private/no-store without a redirect; signed-in unauthorized access stays 403; page sign-in behavior remains intact. |
| Valid picking bins / QA1-WMS-001 | Insufficient first bin and sufficient alternate bin; explicit source-bin constraint, wrong warehouse/serial, held stock, competing reservation and stale state remain protected. Verify the saved source, not only the enabled button. |
| My Work / QA3-001 | Multiple pages with mixed-case IDs retain all authorized records; repeated-cursor/failure/retry and account-change behavior remain safe. |
| CSV / QA2-F01 | Download the governed CSV; unknown cells stay blank with `unknown`, verified zero stays 0 with `available`, and the UI agrees. Missing source data must not become zero. |
| Finance scope / QA2-F02 | Include old and current activity; monthly totals, current inventory value and all-time detail are clearly distinguished on desktop/mobile. |
| Product accessibility / QA3-002 | Workflow regions have distinct record/version/product names at desktop/mobile widths; keyboard and screen-reader navigation retain their context. |
| WMS evidence / QA1-WMS-002 through QA1-WMS-005 | Serialized/bundle pick-pack-release-return, combined-role self-review denials, cross-location transfer, event issue/unused return, complete-day reconciliation/governed export and interrupted-command recovery need their own isolated live evidence. |
| Cross-module evidence / QA2-G01 through QA2-G03 | Fresh coherent Legal-to-Procurement-to-receipt-to-Finance chain, current Product package/recipe/handoff, and seller custody through independent settlement; historical inconsistent fixtures do not certify current controls. |
| Authority assertions / QA4-003 | Effective wrapper/delegation authorization regression evidence, not obsolete function-text matches; the separate acknowledgment line-ending assertion must also be rerun. |
| Release / REL-01 through REL-04 | Same-commit hosted checks, real coverage run, promotion denial checks, exact deployed identity and all current handoff links. |

Use existing authorized accounts and properly assigned training. Agree isolated fixture ownership and cleanup boundaries before writes; do not rewrite real tester approvals, policies, dates, learning or stock. Retain failed and skipped results with reasons. Physical-device acceptance and department sign-off are separate from synthetic automation. SMTP is excluded, not passed.

SCOPE-01 remains an undelivered integration in a [separate Reporting API phase](../../integrations/reporting-api/SEPARATE-IMPLEMENTATION-PHASE.md). Do not attempt to activate it, invent credentials or call a CSV export its acceptance. Its future bootstrap and four incremental cycles are separate tests.
