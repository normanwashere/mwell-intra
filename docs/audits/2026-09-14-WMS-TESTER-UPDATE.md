# Warehouse Update - September 14

At the latest deployment check, UAT is on **b16c8d6** (12:56 UTC). Please leave marked test records and photos in place. The linked evidence page below carries later deployment and test results.

## What's Live

- Onboarding's task chooser is easier to scan. Expand the role count when you need the full list. The supervisor header now shows the correct role.
- Pricing loads all available products, wraps long names and clearly marks incomplete bundles as unavailable.
- Pick-location cards show saved bin codes. Blind counts keep expected quantities and variance hints hidden before submission.
- Receiving practice has a **Finish review** action. A fresh desktop learner completed it and returned to onboarding, but a brief incorrect learning-block message appeared during navigation. A transition fix is prepared; the corrected live check is still open.
- Sourcing now shows the next step for its actual stage, rather than instructions for a later stage.
- Onboarding shows the correct Procurement Admin, Finance and Vendor role labels. Vendor sign-in no longer treats a loading session as an access denial.
- Vendor PDFs are converted locally before upload, fixing the browser-security block. Upload errors now stay visible beside the selected file so you can retry or replace it.

## What We Checked

- Supervisor and combined-role onboarding layouts at desktop and mobile widths, including task search, selection and Back.
- Sourcing opens with the correct 5:00 PM deadline in both views. Earlier unchanged Save/reload checks passed; invitations, evaluation and award were not tested in that check.
- The latest live desktop/mobile checks confirm Procurement Admin and Finance labels. Vendor checks also cover a cold tablet reload and the final required-step and certification labels. These use existing completed learners, not new training passes.
- Logistics submitted a synthetic count and a different supervisor reviewed its image and approved it. Stock changed from **5 to 4**, once. Mobile review of the approved record also passed; this was not a physical count or mobile submission.
- All **1,136 Warehouse regression tests** passed on the released source. CI194 preparation and all six route jobs passed, but both transaction runs stopped at vendor document upload. Each passed 46/48 workflows; cleanup passed. Two vendor screenshots were still loading, so those are not clean visual passes.

## Next Update

The new certification run caught a KB search problem: a general vendor reference can appear ahead of the upload-recovery instructions. The ranking fix now passes the recovery-first test and the full Shell regression run: **806 passed**, with one existing browser-only check skipped. This is a local result, not a successful replacement CI run.

We are also correcting the empty-certificate message for people who have already completed all their learning. Neither change alters permissions or transaction steps.

The fresh desktop receiving test saved one passed attempt with the required review and completion checkpoints. Clicking **Finish review** did not add another attempt, checkpoint or certificate. The navigation fix keeps the old page inactive while returning to the checklist, instead of briefly showing the learning-block message.

Local checks passed **337 Learning tests**, **237 Legal tests** and **144 replenishment tests**. The upload fix still needs its complete live vendor-to-Legal retest; local passes alone do not certify it.

Mobile replenishment completion, additional return branches, live **Finish review**, and full certification remain open. Automated tests do not replace real-user or device acceptance. **SMTP remains untouched.**

[Release details](../releases/2026-09-14-RECEIVING-PRACTICE-CHECKPOINT.md) | [Screenshots and evidence](../../outputs/wms-signoff/sep14-isolated-onboarding-observation/DEPLOYMENT-UPDATE.html)
