# Warehouse Update - September 14

At the latest deployment check, UAT is on **05b2326** (11:07 UTC). Please leave marked test records and photos in place.

## What's Live

- Onboarding's task chooser is easier to scan. Expand the role count when you need the full list. The supervisor header now shows the correct role.
- Pricing loads all available products, wraps long names and clearly marks incomplete bundles as unavailable.
- Pick-location cards show saved bin codes. Blind counts keep expected quantities and variance hints hidden before submission.
- Receiving practice has a **Finish review** action. Its live terminal navigation still needs a fresh eligible learner test.

## What We Checked

- Supervisor and combined-role onboarding layouts at desktop and mobile widths, including task search, selection and Back.
- Sourcing opens with the correct 5:00 PM deadline in both views. Earlier unchanged Save/reload checks passed; invitations, evaluation and award were not tested in that check.
- Logistics submitted a synthetic count and a different supervisor reviewed its image and approved it. Stock changed from **5 to 4**, once. Mobile review of the approved record also passed; this was not a physical count or mobile submission.
- All **1,136 Warehouse regression tests** passed on the released source. CI194 preparation and all six route jobs passed, but both transaction runs stopped at vendor document upload. Each passed 46/48 workflows; cleanup passed. Two vendor screenshots were still loading, so those are not clean visual passes.

## Next Update

Prepared for the next release: stage-appropriate sourcing guidance, correct learning role labels, and a fix for the brief vendor access-denied message during sign-in. We also fixed the PDF conversion that blocked vendor uploads and added a message that stays visible when upload fails. Permissions, workflow steps and browser security stay the same. Local checks passed **337 Learning tests**, **237 Legal tests** and **144 replenishment tests**; live reruns still need to confirm the fixes.

Mobile replenishment completion, additional return branches, live **Finish review**, and full certification remain open. Automated tests do not replace real-user or device acceptance. **SMTP remains untouched.**

[Release details](../releases/2026-09-14-RECEIVING-PRACTICE-CHECKPOINT.md) | [Screenshots and evidence](../../outputs/wms-signoff/sep14-isolated-onboarding-observation/DEPLOYMENT-UPDATE.html)
