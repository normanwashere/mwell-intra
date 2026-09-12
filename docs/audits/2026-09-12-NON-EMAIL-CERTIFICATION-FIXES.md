# September 12 non-email certification fixes

## What changed

- Vendor case status labels wrap at narrow widths instead of extending beyond the screen.
- The interaction audit re-centers a control when late-loaded content moves it. It still fails real overlays, small touch targets and continuously shifting layouts.
- Completed vendor training is recognized through the vendor's current role, accepted invitation and completed training evidence. Vendors do not receive internal department membership. Employee authorization and private function grants are unchanged.
- Invitation-form inspection no longer earns credit for application submission or Legal handoff. Only recorded actions can count toward certification.
- The vendor PO component test now follows the current document-review and revision controls. The bounded performance runner checks deployment identity, timeouts and stable permissions for every role.

## Verified so far

- UAT run #175 completed: preparation, desktop 1440/1280, tablet 768 and mobile 360 routes passed. Mobile 390 and 320 route failures are addressed by the fixes above, pending candidate live retest.
- Desktop recorded 44 successful non-email workflows; its invitation delivery step failed. Mobile recorded 45 successful workflow entries, but the invitation entry only inspected the form. It does not prove vendor application submission or Legal handoff.
- Both independent CI cleanup jobs passed. Historical run #175 remains failed, not retrospectively certified.
- Focused regression suite: 69 passed. Additional contract and learning checks: 103 passed, one skipped. Knowledge content and evidence checks: 81 passed. All 15 workspace typecheck tasks passed.
- Vendor authority on UAT changed from denied to allowed for the completed isolated vendor. Internal department memberships remained zero and the private function ACL remained unchanged.
- Actual desktop 1440 and mobile 390 PO review/acknowledgment passed on two disposable UAT fixtures. Refresh retained revision 2; database readback showed exactly one acknowledgment event per PO, with the expected vendor actor and reference. Both POs, requests, lifecycle states and events were removed; remaining counts were zero.
- Independent review tightened the runner to require exact database error codes/messages and unchanged revision after rejection. The second live run passed all 12 checks, including explicit idempotent replay. Independent database readback confirmed the exact document hash, actor, reference and single event per PO; guarded cleanup again left zero fixture records. This rejects unavailable IDs, not a live cross-vendor test.

## Limits

SMTP and email delivery are deferred by the project owner. Full vendor application and Legal handoff require separate evidence; opening an invitation form is insufficient. A real-user pilot and maximum-capacity test are not certified. The existing 99-read performance result covers bounded permission reads across 11 roles, not transaction throughput.

Working-copy lint encounters errors in a pre-existing, untracked Finance browser script. That unrelated script is not part of this release; the clean tracked release must pass lint independently.

## Evidence locations

- `outputs/sep12-performance/ci175-final/`: original CI route, transaction and cleanup reports.
- `outputs/sep12-performance/vendor-ack-live/`: actual vendor acknowledgment captures and run report.
- `outputs/sep12-performance/ci175-isolated-read-followup/api.json`: bounded live read performance.
- `scripts/qa/vendor-po-ack-fixtures.sql` and `vendor-po-ack-cleanup.sql`: disposable fixture preparation and guarded cleanup.

No purchasing, receiving, approval, payment or stock-movement process was redesigned in this change.
