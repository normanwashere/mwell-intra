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

The new replenishment form passed local tests and a live open/edit/cancel check. Its two-user acceptance-to-draft exercise is still open.

We also fixed the source of the training CI failure: permission updates were silently expanding older training definitions. The correction passed all 298 Learning tests and independent review, with the original checks kept intact. It does not reset anyone's progress, publish new training or mark a user trained. The release and a fresh CI run still need verification.

Still open: the remaining isolated-role journeys, new training coverage, older guides outside receiving/Quality, and the actual user/device pilot. SMTP is not included.

[Detailed verification and limits](2026-09-14-WMS-DISPLAY-LIVE-REVIEW.md)

[Role and action checks](2026-09-14-WMS-ROLE-AUTHORITY-REVIEW.md)

[Replenishment checks and remaining work](2026-09-14-WMS-REPLENISHMENT-REMEDIATION.md)
