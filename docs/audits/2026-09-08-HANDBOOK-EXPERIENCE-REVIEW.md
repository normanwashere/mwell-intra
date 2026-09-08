# Offline Handbook Experience Review

September 8 follow-up: the receiving date gap described in this review's original snapshot has a subsequent implementation in UAT revision `86b5bc81f5d3bccfd820933b6a20f11b9c05022e`. Current verification is tracked in [open-items remediation](2026-09-08-SEPT7-OPEN-ITEMS-REMEDIATION.md). The navigation recommendations below remain separate from those application fixes.

## Recommendation

Retain the standalone, searchable HTML handbook and its desktop navigation. Improve the existing structure rather than adding another documentation platform. The priority is to help a reader find a task, identify their responsibility, perform the step, and recognize completion or a safe recovery path. An offline handbook is reference material, not proof that the reader completed training.

This review uses the current source and generated handbook plus a separate desktop browser check. It is not a new-user usability study. A source inspection or working link does not establish that readers understand the guidance.

## Changes Included Now

- September 7 merchandise guidance is linked into both receiving and departmental release, including searchable product and tester PO terms.
- The release guide includes Marketing and Operations Associate participation, not only the requester and lead.
- The receiving instructions acknowledge the actual-delivery-date field gap and tell users to retain the dated delivery note. They do not present the expected PO date as actual delivery.
- The handbook describes quantity-controlled merchandise, variant-specific barcodes, independent inspection, exact picked-bin release and recovery.
- Six untouched tester POs are distinguished from consumed verification records and from stock already available to issue.
- The incorrect no-results role-guide destination now opens the role list, not the administrator guide; its regression test passed. Final browser verification is recorded in the release receipt.

## Prioritized Improvements

| Priority | Current problem | Specific action | Acceptance test |
| --- | --- | --- | --- |
| P1 | All-guides search suppresses system references unless a technical-intent term is recognized. It caps displayed results at eight without a complete-results path. | Keep tasks ranked first, but provide an explicit references filter, total count and Show more results. Never imply eight is the total when more matches exist. | A known policy term, exact task term and infrastructure term each return their destination; keyboard users can reach results beyond the first eight. |
| P1 | Task instructions mix action guidance with repeated data, evidence and audit detail. | Keep Action, Expected result and Next owner visible. Place technical fields and audit explanation in labelled disclosures. Keep the next-role handover visible even when filtering for My steps. | A new Operations Associate can identify what to do, what success looks like and who acts next without opening technical reference. |
| P1 | Older screenshots and a global August 25 baseline can appear beside newer content. | Record review date and applicability per guide; label historical screenshots. Preserve capture dates and use exact record/state captions. Do not blanket-update certification dates. | Each changed guide identifies its applicable behavior and screenshot age; no old image is presented as a new live capture. |
| P2 | Source and change-history material can obscure everyday instructions. | Separate practice tutorials, task procedures, reference and explanations. Keep release notes in a dedicated reference destination, linked only where they affect the task. | Receiving begins with prerequisites and actions, not an accumulated release chronology. Policy and architecture remain accessible without appearing in every task. |
| P2 | Screenshot captions do not consistently identify the record, state and visible control. | For each step, show an original screenshot with a precise caption: role, page, selected record, action and expected state. Offer full-size viewing; do not claim off-screen controls are shown. | A reader can point to the relevant control and explain the next action from the screenshot and caption alone. |
| P2 | Dense operational and technical content has different audiences. | Keep the desktop navigation stable: tasks, roles and system reference. Use breadcrumbs, a current-location marker and a compact in-page contents list. Keep search and Back predictable. | At 1280 and 1440 pixels, a reader can move between a task and its reference, then return to the same step using keyboard or browser Back. |

## Desktop Browser Findings

The current 1440px and 1280px browser checks passed tab navigation, guide reload, disclosures, browser Back and no-results role recovery. However, four strict direct-section assertions failed: searching `tumbler` or `PO-0005` finds the appropriate task's Outcome, not the September 7 answer itself. The reader must open the governed source and scroll to the subsection. Add a visible task-level answer link and an exact subsection search destination as a P1 improvement. Do not call the current behavior direct-answer navigation.

Two further presentation improvements were observed: search results occupy a narrow left column while the previous reading canvas remains, and scrolled text faintly shows through the translucent top bar. Use a wider dedicated results layout and an opaque toolbar background. The actual September 7 paragraphs were readable at both widths. See [desktop audit evidence](../../outputs/sep08-manual-audit/REPORT.md). These findings supplement the source review; they are not an all-sections usability certification.

## Documentation Principles

Diataxis distinguishes tutorials, how-to guides, reference and explanation by the reader's need. Applied here, a first practice exercise should not have the same structure as a warehouse procedure or infrastructure reference. This is a design recommendation, not a claim that renaming tabs alone improves comprehension. [Diataxis introduction](https://www.diataxis.fr/start-here/).

GOV.UK guidance bases content on recognizable actions and user needs. For Intra, titles such as Receive merchandise or Resolve a held pick give a clearer starting point than release dates or internal document names. [Identify user needs](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/plan-manage-content/identify-user-needs/).

W3C guidance emphasizes meaningful regions and logically nested headings for orientation and navigation. Preserve that structure in the HTML, provide visible keyboard focus, and verify accessible names on disclosures and navigation. [W3C page structure tutorial](https://www.w3.org/WAI/tutorials/page-structure/).

## Recommended Reader Pilot

After these improvements, observe one new Operations user, one Procurement user and one support/technical user. Ask each to find a task, identify the next owner, recover from an error and locate a policy reference without coaching. Record first destination, time, wrong turns and unresolved questions. Set the success threshold before the pilot; automated accounts and DOM checks must not be recorded as human participants.
