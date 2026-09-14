# Warehouse Update - September 14

## What's Live

- **Returns and Quality:** clearer return summaries, counts that follow the selected tab/search, and larger return-reference links.
- **Forms:** the title, Close button and Save area stay in place while scrolling. App-update notices no longer cover warehouse forms.
- **Access recovery:** a failed permission check now offers **Retry access** instead of incorrectly saying your access was removed.
- **Exports:** Operations Associates with export permission can open Export data from the warehouse home screen.
- **Replenishment:** after accepting a recommendation, Procurement can use **Complete Procurement request** to provide the required details and documents. **Confirm procurement route** remains a separate step.
- **Guides:** receiving instructions now distinguish the receiver, independent inspector and hold reviewer more clearly.

These changes remain on UAT. The latest follow-up is build `b3b7498`, verified on the main UAT address. Required fields, approvals and stock controls still apply.

## What We Checked

All six screen-size jobs passed: two desktop sizes, tablet and three mobile sizes. The warehouse scenarios included in the main CI run passed their existing checks, but those checks do not cover every warehouse journey.

We also removed two obsolete test-role references from an approval group. The real approvers, user assignments and permissions are unchanged. The four old test receipt photos were archived and removed; regular tester data was outside that cleanup.

## Still Being Tested

We fixed the receiving-practice bug and completed the operator's remaining Quality, putaway and pick/pack exercises on UAT. That test account now shows **9 of 9 learning steps complete**, with the results checked in the database. Emergency access still needs approval. Other role journeys and a fresh uninterrupted receiving run are still being tested; this is not an all-roles or full transaction pass.

The original replenishment request now opens correctly on live UAT: its confirmed route, two attachments and not-started sourcing form are visible without the earlier error. We checked desktop and mobile. We also found a separate problem when a sourcing event already exists and are correcting that read without changing who can approve. Please leave marked audit records to us; do not create duplicates to work around them.

The onboarding layout candidate puts progress and the next Start/Resume action first. Task selection is tucked into an expandable control, and long button labels no longer crowd the page. Desktop and mobile screenshots have been reviewed locally; deployment and live checks are still pending.

Seven separate warehouse test accounts are now ready, including an operator/supervisor multi-role account. All seven signed in; 217 capability checks found no assignment mismatches. A separate database check matched all 111 warehouse role-permission entries to the app definitions. Existing tester accounts were unchanged. These checks do **not** mean the new accounts have completed onboarding or their warehouse transactions.

Remaining work includes the isolated-role journeys, the remaining training/guide coverage, and checks with actual warehouse users and devices. The main CI run also has incomplete vendor invitation/onboarding evidence. SMTP remains outside this warehouse work.

**UAT is available for testing. Full WMS certification is still open.**

[Detailed fixes and verification](2026-09-14-WMS-REPLENISHMENT-REMEDIATION.md) | [Role checks](2026-09-14-WMS-ROLE-AUTHORITY-REVIEW.md) | [Visual checks](2026-09-14-WMS-DISPLAY-LIVE-REVIEW.md)
