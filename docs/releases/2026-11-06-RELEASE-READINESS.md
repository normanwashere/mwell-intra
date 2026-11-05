# November 6 Release Readiness

Status: fixes and verification in progress. This is not a deployment notice or a go-live approval. Use the [current release manifest](../handoffs/current/release-status.json) for the serving UAT version.

## What Is Being Finished

- Return screens use the authoritative remaining balance, including previous sales and returns. A failed balance check must not become a zero or permit an unverified return.
- Product links retain their record destination after reload. Export screens explain loading, unavailable data and missing permission without changing access.
- Narrow-screen onboarding keeps the task entry visible; required training, task checkpoints and permissions remain unchanged.
- CI browser setup installs its configured Chromium engine and proves that it can launch before running journeys. Installation failure is still a failure, not a skipped pass.
- Mobile reachability checks use overlapping scroll samples and allow only 0.001px measurement tolerance. Tests still reject real overlays and undersized controls.
- Controlled Procurement fixtures are being aligned with real paging, registered payment evidence and independent actor permissions. Fixture corrections do not certify live Legal or payment processing.
- Tablet layouts keep Fulfillment filters within the page, allow Insights tabs to wrap, and retain visible Finance status controls. Existing actions, permissions and handoffs are unchanged. Regression checks include reserved scrollbar space so clipping is not hidden by the test device.
- On narrow phones, Fulfillment tabs retain enough width for their labels instead of overlapping. Label-boundary and navigation checks supplement the existing layout audit; tabs that a role cannot use remain hidden, with direct links falling back to an allowed view.
- The Warehouse header keeps a stable height while scrolling. This prevents repeated resizing on short desktop pages while retaining its scroll shadow; keyboard and pointer navigation are tested at the affected scroll position.

## Stock Conversion Follow-Up

An external-PO inspection can accept a serialized unit before its first putaway assigns a bin. The old conversion check expects the inspection and current unit bin to match, leaving that unit without an eligible inspection in the conversion screen.

The proposed forward migration records the exact future receipt, independent Quality decision and first single-serial putaway. It keeps the original inspection unchanged and rechecks eligibility when creating, approving and completing a conversion. Later custody, holds, inspection or return changes invalidate this carried evidence. Existing exact-bin inspection and return recovery rules stay intact.

This is deliberately limited to newly recorded eligible stock. It does not repair historical stock, authorize new recipes, certify packaging conversion or remove independent approval. After all 11 CI checks passed for `d4d5967`, UAT recorded the migration as `20261105233321_stock_conversion_qc_putaway_bridge.sql`, replacing the source filename version `20261105195433`. The recorded SQL bytes match the reviewed file. Post-application checks confirmed unchanged existing function permissions, three private RLS-protected tables, six inaccessible internal helpers and the expected triggers/indexes. This proves schema application, not a completed live stock-conversion journey.

The migration caps each lock wait at five seconds and each statement at sixty seconds, retains stricter caller limits, and restores those settings at transaction end. This is not a total transaction deadline. A blocked application must fail and be inspected before any retry; active testers are never terminated to make it succeed. The native PostgreSQL gate includes real lock contention and rollback/commit setting checks on an owned scratch table.

## Release Gates

1. Resolve all required CI failures and pass all 11 checks on the exact candidate commit.
2. Review and verify the forward migration, then deploy only to the existing UAT project. Confirm the alias and health identity.
3. Rerun affected return, Product, export, privacy and workflow checks using isolated records. Preserve existing tester accounts, stock, approvals and history.
4. Complete the approved isolated vendor journey when UAT Auth administration is available. Do not substitute an old vendor, send email, sign a real agreement or make a real payment.
5. Publish actual outcomes and evidence, then coordinate the WMS departmental test run. Physical scanners/cameras and human acceptance remain separate gates.

The WMS checklist retains 24 cases and 90 lettered variants. Record each variant separately as Pass, Fail, Blocked or Not Run; one successful path does not close an entire case. No core stock, permission, hold or approval failure is waived by this update.

SMTP remains untouched. The Reporting API is a separate, disabled implementation phase.
