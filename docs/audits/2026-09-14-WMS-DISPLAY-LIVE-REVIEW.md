# Warehouse Display Update: Live Review

## Released

UAT is serving `c285863112ff43531980a79b22c358dd2bb959a9` from deployment `dpl_AkhWXDirAikptQTqsViNT1TJfw81`. The public alias health check at `2026-09-13T15:58:22.525Z` confirmed `appEnv=uat`, Supabase project `kkoitlvydytdhlpxhuah`, reachable Supabase and CSS. Only the UAT Vercel project was targeted. No database migration accompanies this display release.

The release includes the return-status and Quality-count fixes, matching KB controls, four maintained source documents and the rebuilt standalone handbook. Pre-release checks passed: 249 focused warehouse tests, warehouse typecheck, 61 KB tests, 82 handbook tests, release-documentation synchronization, HTML freshness and the production build. These are bounded results, not full WMS certification.

## Direct Live Checks

The parent reused the existing UAT Operations Lead browser session. After the update prompt, Reload was selected before validating the new screens. No return, inspection, stock movement, upload or resolution submission was performed. This was an interactive UI review, not the earlier network-guarded transaction runner.

- Quality Completed: searching for retained return `ret-9653612b-bf28-48ae-81dc-faf310924e88` showed **1 of 9 completed inspections**, the matching accepted inspection `87b8079e-06a9-4d17-8af6-111dcc8d2089`, and its synthetic evidence thumbnail. Desktop 1440x900 and narrow 390x844 views were visually reviewed.
- Clearing search with Ctrl+A and Backspace restored **9 completed inspections**. The browser tool's empty-string fill did not clear the field; it was not counted as a successful UI check.
- Holds with a nonmatching search showed **0 of 0 active holds** for this session. This verifies the empty state, not a populated active-hold list or any hold-release operation.
- The retained submitted test case `61f3a8c3-97d2-4590-a3a7-4f98eac33d65` showed **Customer case submitted / awaiting resolution** and explicitly unverified physical intake/current Quality status. Its original synthetic order remained visible on desktop and narrow view. This case has no recorded physical intake; it does not prove the linked-intake branch live.
- Choosing **New delivery details** correctly disabled Save while required replacement fields were empty. The original-delivery form's Save remained enabled under its existing validation behavior; no submission was attempted. The form was closed without saving and the viewport override was reset.

The live images were captured and reviewed through the browser tool in this task. They are not archived PNG certification files. The earlier 33-file component capture remains separate and must not be relabeled as this live review. Narrow desktop-browser resizing is not actual-phone, touch or virtual-keyboard certification.

## Open Mobile Finding

**Follow-up candidate:** the parent reproduced an outer scroll of 105px after native centered field scrolling with the actual hierarchy stylesheet, then changed only `overflow:hidden` to `overflow:clip`. The same test passed with 33 captures. A separate 24-case shared-Sheet suite passed for adaptive, bottom, right and center layouts at 1440, 390 and 320px with normal/reduced motion, focus containment, body scrolling and Escape/Close focus restoration. Four shared-Sheet images and two updated return images were visually reviewed. Deployment and repeat live checks remain required for this follow-up.

Independent testing reproduced the focus/scroll susceptibility with actual bundled Poppins fonts and found one intermittent ordinary automated focus/check occurrence after resizing. Plain raw keyboard Tab alone passed with both old and proposed CSS, so a human-only keyboard defect is not established. The fix is defensive frame containment, not a business-process or authorization change.

After changing an open desktop resolution dialog to 390x844 and focusing **New delivery details**, the outer dialog scrolled as well as its body. This clipped the title/Close area and lifted the action footer above unused space. The underlying form still disabled incomplete new delivery; no workflow bypass was observed.

Measured live: dialog top 67.525, bottom 844, height 776.475; `scrollHeight=982`, `scrollTop=85.6`, `overflow:hidden`. Header top 1.925 was above the dialog's clipping boundary. Body retained its own scroll position. Browser DPR was 1.25.

The server-free harness now includes `hierarchy-preview.css`, outer-scroll/header/footer assertions, desktop-to-mobile resizing and DPR 1.25. These local checks pass but have **not reproduced or fixed** the live finding. An independent agent has been assigned a read-only investigation. Do not mark mobile dialog layout fully certified.

## Remaining Scope

Isolated-role provisioning remains offline reviewed only; seven proposed identities and their live journeys have not been executed. Broader receiving exceptions, stock types, return dispositions, concurrency/recovery, exact-step archived screenshots and actual hardware/user acceptance remain open. SMTP remains excluded. Earlier archived cleanup and retained transaction evidence keep their original run/build identities.
