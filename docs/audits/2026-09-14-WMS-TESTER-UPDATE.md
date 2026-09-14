# Warehouse Update - September 14

## What's Live

- **Returns and Quality:** clearer return summaries, counts that follow the selected tab/search, and larger return-reference links.
- **Forms:** the title, Close button and Save area stay in place while scrolling. App-update notices no longer cover warehouse forms.
- **Access recovery:** a failed permission check now offers **Retry access** instead of incorrectly saying your access was removed.
- **Exports:** Operations Associates with export permission can open Export data from the warehouse home screen.
- **Replenishment:** after accepting a recommendation, Procurement can use **Complete Procurement request** to provide the required details and documents. **Confirm procurement route** remains a separate step.
- **Guides:** receiving instructions now distinguish the receiver, independent inspector and hold reviewer more clearly.

These changes remain on UAT. The latest follow-up is build `c1b09d6`, verified on the main UAT address at 03:50 UTC on September 14. Required fields, approvals and stock controls still apply.

## What We Checked

All six screen-size jobs passed: two desktop sizes, tablet and three mobile sizes. The warehouse scenarios included in the main CI run passed their existing checks, but those checks do not cover every warehouse journey.

We also removed two obsolete test-role references from an approval group. The real approvers, user assignments and permissions are unchanged. The four old test receipt photos were archived and removed; regular tester data was outside that cleanup.

## Still Being Tested

We fixed the receiving-practice bug and completed the operator's remaining Quality, putaway and pick/pack exercises on UAT. That test account now shows **9 of 9 learning steps complete**, with the results checked in the database. Emergency access still needs approval. Other role journeys and a fresh uninterrupted receiving run are still being tested; this is not an all-roles or full transaction pass.

The original replenishment request now opens correctly on live UAT. We created a sourcing plan on that same request and reopened it successfully on desktop and mobile. That retest caught a deadline mismatch between the editor and saved summary. The correction passes timezone tests; we still need to check Save again after deployment. Please leave marked audit records to us; do not create duplicates to work around them.

The onboarding layout is now live. Progress and the next Start/Resume action come first. Task selection is tucked into an expandable control, and long button labels no longer crowd the page. We reviewed live desktop and mobile screenshots: the mobile Start button is above the bottom navigation, and neither view has horizontal clipping.

The separate Operator, Supervisor, Logistics, Operations and Pricing accounts have completed their assigned learning. Shared steps count once where the published learning rules allow it. This does not mean every business transaction has passed. The administrator check also found a missing role label on earned certifications; that display-only correction is being verified.

The previous CI run passed all six route/screen-size checks and both independent cleanup jobs. Desktop passed 44 of 45 workflow records; mobile passed 45 of 45, but both lacked the complete vendor application-to-Legal handoff evidence. A desktop vendor-heading check also used a shortened text preview and has a tested correction. We are not counting those gaps as passes. The newest CI run stopped because the generated handbook was out of date; its later tests did not run. We are correcting the release-document check before rerunning certification.

Seven separate warehouse test accounts are now ready, including an operator/supervisor multi-role account. All seven signed in; 217 capability checks found no assignment mismatches. A separate database check matched all 111 warehouse role-permission entries to the app definitions. Existing tester accounts were unchanged. These checks do **not** mean the new accounts have completed onboarding or their warehouse transactions.

Remaining work includes the isolated-role journeys, the remaining training/guide coverage, and checks with actual warehouse users and devices. The main CI run also has incomplete vendor invitation/onboarding evidence. SMTP remains outside this warehouse work.

**UAT is available for testing. Full WMS certification is still open.**

[Detailed fixes and verification](2026-09-14-WMS-REPLENISHMENT-REMEDIATION.md) | [Role checks](2026-09-14-WMS-ROLE-AUTHORITY-REVIEW.md) | [Visual checks](2026-09-14-WMS-DISPLAY-LIVE-REVIEW.md)
