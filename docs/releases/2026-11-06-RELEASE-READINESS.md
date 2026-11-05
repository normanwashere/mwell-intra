# November 6 Release Readiness

Status: fixes and verification in progress. This is not a deployment notice or a go-live approval. Use the [current release manifest](../handoffs/current/release-status.json) for the serving UAT version.

## What Is Being Finished

- Return screens use the authoritative remaining balance, including previous sales and returns. A failed balance check must not become a zero or permit an unverified return.
- Product links retain their record destination after reload. Export screens explain loading, unavailable data and missing permission without changing access.
- Narrow-screen onboarding keeps the task entry visible; required training, task checkpoints and permissions remain unchanged.
- CI browser setup installs its configured Chromium engine and proves that it can launch before running journeys. Installation failure is still a failure, not a skipped pass.
- Mobile reachability checks use overlapping scroll samples and allow only 0.001px measurement tolerance. Tests still reject real overlays and undersized controls.
- Controlled Procurement fixtures are being aligned with real paging, registered payment evidence and independent actor permissions. Fixture corrections do not certify live Legal or payment processing.

## Stock Conversion Follow-Up

An external-PO inspection can accept a serialized unit before its first putaway assigns a bin. The old conversion check expects the inspection and current unit bin to match, leaving that unit without an eligible inspection in the conversion screen.

The proposed forward migration records the exact future receipt, independent Quality decision and first single-serial putaway. It keeps the original inspection unchanged and rechecks eligibility when creating, approving and completing a conversion. Later custody, holds, inspection or return changes invalidate this carried evidence. Existing exact-bin inspection and return recovery rules stay intact.

This is deliberately limited to newly recorded eligible stock. It does not repair historical stock, authorize new recipes, certify packaging conversion or remove independent approval. Migration `20261105195433_stock_conversion_qc_putaway_bridge.sql` is under review and is **not recorded as applied**. Local SQL checks are not live or concurrent acceptance.

## Release Gates

1. Resolve all required CI failures and pass all 11 checks on the exact candidate commit.
2. Review and verify the forward migration, then deploy only to the existing UAT project. Confirm the alias and health identity.
3. Rerun affected return, Product, export, privacy and workflow checks using isolated records. Preserve existing tester accounts, stock, approvals and history.
4. Complete the approved isolated vendor journey when UAT Auth administration is available. Do not substitute an old vendor, send email, sign a real agreement or make a real payment.
5. Publish actual outcomes and evidence, then coordinate the WMS departmental test run. Physical scanners/cameras and human acceptance remain separate gates.

The WMS checklist retains 24 cases and 90 lettered variants. Record each variant separately as Pass, Fail, Blocked or Not Run; one successful path does not close an entire case. No core stock, permission, hold or approval failure is waived by this update.

SMTP remains untouched. The Reporting API is a separate, disabled implementation phase.
