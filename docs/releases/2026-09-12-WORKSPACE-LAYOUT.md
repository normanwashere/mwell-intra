# September 12 Workspace Layout Release

## What Changed

The approved layout now applies through the shared internal and vendor workspace containers, not just the three pilot screens. Page headers, section bands and dialog surfaces have clearer contrast in both themes. Status colors keep their existing meanings.

Desktop navigation can be hidden/restored and remains reachable while scrolling. My Work rows are more compact. Order details and intake have wider, grouped desktop layouts and mobile stacking; dialog action footers remain separate. PO amendment inputs align without changing their validation. Supported record copying and list-return convenience are included.

## Workflow Boundaries

No database, role, authorization, approval, inventory or payment command changes. Existing seeded tester records remain intact. Unsaved warnings are limited to procurement browser exit/Cancel and order-intake failed local draft persistence; they do not cover every in-app navigation.

## Verification And Deployment

Deploy to the existing mwell-intra-uat project using its configured production-target environment. Verify the deployed commit, appEnv uat and Supabase reference kkoitlvydytdhlpxhuah. Capture the final live receipt and role-screen results as release evidence. This release note describes scope; it does not itself certify that deployment or every transaction passed.

Updated references: standalone operating handbook, training/operations manual, technical/functional specification, training handover and in-app navigation guidance. Historical screenshots retain their historical labels; fresh release screenshots belong in the live validation gallery.
