# Warehouse Update - September 14

A few more fixes are live on UAT:

- **Returns:** the summary now separates the customer case from physical receipt of the item. It also makes clear that a recorded return does not mean Quality has cleared the stock.
- **Quality:** the count now follows the tab and search you are viewing. Clear search to see the full list.
- **Forms:** the title, Close button and Save area now stay in place when you scroll to a lower field. We checked the return form on desktop and at 390px and 320px widths.
- **Exports:** Operations Associates with export permission can now open Export data from their warehouse home screen. We checked the dialog on desktop and mobile.
- **Action buttons:** export and replenishment buttons now follow the permission needed for that action, not just permission to view the page.
- **Guides:** the export instructions now explain page access and export permission separately. We checked the updated wording on desktop and mobile.
- **Replenishment:** authorized Operations users can now open an item in Inventory and choose Recommend replenishment. Procurement still handles acceptance and the linked draft request. We fixed the incorrect permission error and protected recommendations that Procurement has already accepted.
- **Receiving guides:** the KB and handbook now distinguish the receiver, independent inspector and hold reviewer more clearly. These are the existing checks, not extra approval steps.
- **Mobile forms:** the app-update notice no longer covers open warehouse forms. We checked desktop and both 390px and 320px screens with an update actually waiting. Reload is still your choice after closing the form.

The process and database permissions have not changed. We corrected the app's role list and made the role guides and handbook clearer about who requests, who handles stock and who approves.

The warehouse app changes passed 1,053 tests. The latest guide update passed 746 shell tests, with one skip. Live checks on the preceding application release covered 341 permission decisions across 11 test accounts, with no mismatches. Some audit visibility is intentionally restricted, so this is not full WMS certification.

Required fields and permissions still apply. Empty replacement delivery details still prevent saving. The live form checks were closed without changing the test record.

The four old test receipt photos have been archived and cleaned up. Your regular test data was outside that cleanup. Please leave the marked WMS audit records to us.

We tested replenishment with separate Operations and Procurement accounts on desktop and mobile. Both recommendations were saved, accepted and linked to draft purchase requests. All 14 permission, sequencing and duplicate-action checks passed, with no purchase orders or stock movements created.

There is still a real handoff issue: those new drafts are missing a requirement classification, so Procurement cannot continue routing them. The saved reason also does not appear in the right field. We caught both while reviewing the screenshots. We are fixing the handoff so Procurement can supply the required details through the existing request form. Please do not create duplicate requests to get around it. A separate read-only check now confirms the correct item and quantity on both desktop and mobile, but the full journey is not passed yet.

**Access recovery is now live on UAT (`48ca3a7`).** We checked desktop and mobile: the draft stayed in place during a successful focus check. When we simulated a failed permission read, the app showed **Could not verify warehouse access** instead of saying your access was removed. **Retry access** restored the page without repeating a transaction. We reviewed screenshots of both the error and the recovered page. Unsaved work is still not guaranteed after a failed check or reload.

Return-reference links now have larger tap areas, with the same destinations. We also corrected the test that mistook the gap between wrapped links for an obstruction. Both changes are released. The first focused check passed 11 of 12 role-and-screen combinations. A separate 320px follow-up now passes all four links and Back navigation, with eight screenshots reviewed. That closes the focused check without relabeling the earlier failed report. A separate display issue with the replenishment button is fixed locally but not released yet.

We also fixed the source of the training CI failure: permission updates were silently expanding older training definitions. That correction shipped in `4b2a8e1` and remains included. It passed all 298 Learning tests and independent review, with the original checks kept intact. It does not reset anyone's progress, publish new training or mark a user trained. The release is not fully certified yet.

The replenishment completion fix has passed independent code review and the application build. We are preparing its live test and updated instructions before rollout. It will let Procurement complete the missing details in the existing request form, keeping the original recommendation linked. It is not live yet, so please leave the two marked audit drafts for us to review.

All six screen-size checks passed in the latest CI run: two desktop sizes, tablet and three mobile sizes. The warehouse checks included in the transaction runs also passed. Full CI is still red because vendor invitation/onboarding evidence is incomplete: desktop email delivery hit a rate limit. Both cleanup checks passed. SMTP stays outside this warehouse work, as agreed; we are not calling the whole app certified.

We also made the Warehouse home link easier to click without moving the sidebar items. That small layout fix and the replenishment completion fix are tested locally but are not live yet. We are tightening the audit report too, so a step that was not tested cannot show as passed.

Still open: the remaining isolated-role journeys, new training coverage, older guides outside receiving/Quality, and the actual user/device pilot. The permission-read failure described above is fixed and checked on the released build; broader session scenarios still need coverage. An older SQL-verifier gap remains separate from this fix. SMTP is not included.

[Detailed verification and limits](2026-09-14-WMS-DISPLAY-LIVE-REVIEW.md)

[Role and action checks](2026-09-14-WMS-ROLE-AUTHORITY-REVIEW.md)

[Replenishment checks and remaining work](2026-09-14-WMS-REPLENISHMENT-REMEDIATION.md)
