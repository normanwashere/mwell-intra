# Warehouse Display Update: Live Review

## Released

UAT is now serving `9e67f47fa20c553710f77fc7555819f098a203b7` from deployment `dpl_EATWRpPYgntaNyar1S2g6GcySjfd`. Public alias health at `2026-09-13T16:26:13.635Z` confirmed the exact commit, `appEnv=uat`, Supabase project `kkoitlvydytdhlpxhuah` and reachable Supabase. This includes the stationary dialog frame and matching KB/manual updates. No database migration was needed.

The preceding status/count release was `c285863112ff43531980a79b22c358dd2bb959a9`, deployment `dpl_AkhWXDirAikptQTqsViNT1TJfw81`. Its public alias health check at `2026-09-13T15:58:22.525Z` confirmed the same UAT project and reachable Supabase/CSS. The historical checks below retain that build identity. Only the UAT Vercel project was targeted.

The release includes the return-status and Quality-count fixes, matching KB controls, four maintained source documents and the rebuilt standalone handbook. Pre-release checks passed: 249 focused warehouse tests, warehouse typecheck, 61 KB tests, 82 handbook tests, release-documentation synchronization, HTML freshness and the production build. These are bounded results, not full WMS certification.

## Direct Live Checks

The parent reused the existing UAT Operations Lead browser session. After the update prompt, Reload was selected before validating the new screens. No return, inspection, stock movement, upload or resolution submission was performed. This was an interactive UI review, not the earlier network-guarded transaction runner.

- Quality Completed: searching for retained return `ret-9653612b-bf28-48ae-81dc-faf310924e88` showed **1 of 9 completed inspections**, the matching accepted inspection `87b8079e-06a9-4d17-8af6-111dcc8d2089`, and its synthetic evidence thumbnail. Desktop 1440x900 and narrow 390x844 views were visually reviewed.
- Clearing search with Ctrl+A and Backspace restored **9 completed inspections**. The browser tool's empty-string fill did not clear the field; it was not counted as a successful UI check.
- Holds with a nonmatching search showed **0 of 0 active holds** for this session. This verifies the empty state, not a populated active-hold list or any hold-release operation.
- The retained submitted test case `61f3a8c3-97d2-4590-a3a7-4f98eac33d65` showed **Customer case submitted / awaiting resolution** and explicitly unverified physical intake/current Quality status. Its original synthetic order remained visible on desktop and narrow view. This case has no recorded physical intake; it does not prove the linked-intake branch live.
- Choosing **New delivery details** correctly disabled Save while required replacement fields were empty. The original-delivery form's Save remained enabled under its existing validation behavior; no submission was attempted. The form was closed without saving and the viewport override was reset.

The live images were captured and reviewed through the browser tool in this task. They are not archived PNG certification files. The earlier 33-file component capture remains separate and must not be relabeled as this live review. Narrow desktop-browser resizing is not actual-phone, touch or virtual-keyboard certification.

## Mobile Finding: Fixed And Rechecked

The parent reproduced an outer scroll of 105px after native centered field scrolling with the actual hierarchy stylesheet, then changed only `overflow:hidden` to `overflow:clip`. The same test passed with 33 captures. A separate 24-case shared-Sheet suite passed for adaptive, bottom, right and center layouts at 1440, 390 and 320px with normal/reduced motion, focus containment, body scrolling and Escape/Close focus restoration. Four shared-Sheet images and two updated return images were visually reviewed. Another 51 warehouse form/accessibility tests, 61 KB tests, 82 handbook tests, production build and release-documentation checks passed.

Independent testing reproduced the focus/scroll susceptibility with actual bundled Poppins fonts and found one intermittent ordinary automated focus/check occurrence after resizing. Plain raw keyboard Tab alone passed with both old and proposed CSS, so a human-only keyboard defect is not established. The fix is defensive frame containment, not a business-process or authorization change.

After changing an open desktop resolution dialog to 390x844 and focusing **New delivery details**, the outer dialog scrolled as well as its body. This clipped the title/Close area and lifted the action footer above unused space. The underlying form still disabled incomplete new delivery; no workflow bypass was observed.

Measured live: dialog top 67.525, bottom 844, height 776.475; `scrollHeight=982`, `scrollTop=85.6`, `overflow:hidden`. Header top 1.925 was above the dialog's clipping boundary. Body retained its own scroll position. Browser DPR was 1.25.

After deploying `9e67f47`, the parent reloaded UAT and accepted the app's available-update Reload prompt. The same synthetic case was opened without submitting. At 390x844, choosing New delivery details kept outer `scrollTop=0`, computed `overflow=clip`, header top 87.525 inside dialog top 67.525, and footer bottom 828 inside dialog bottom 844. Save was disabled for empty new details. At 320x720, outer scroll remained zero with header top 77.6 inside dialog top 57.6 and footer bottom 704 inside dialog bottom 720. Original delivery preserved the existing enabled-Save state; no save was attempted.

At 1440x900 the frame was contained at x=144, y=82, width=1152, height=736 with scroll zero. Resizing this open desktop form back to 390x844 and selecting New delivery details repeated the passing geometry. The form was closed without saving and the viewport reset. Three stable live screenshots were visually reviewed in the browser tool; an earlier immediately-after-resize image had transitional framing and was not accepted as the 320px screenshot. These images remain in task output, not archived PNG certification evidence. Actual phones, touch and virtual keyboards remain untested.

Offline evidence: `outputs/wms-signoff/sheet-frame/2026-09-13T16-15-19-269Z/report.json` and `outputs/wms-signoff/workflow-status-layout/2026-09-13T16-13-41-920Z/report.json`. Independent Poppins-font A/B investigation: `outputs/wms-signoff/sheet-focus-independent/1789316179256/report.json`. This is a verified targeted fix, not certification of every dialog or workflow.

## Bounded Read Performance

On the preceding `c285863` build, 99 capability-snapshot reads across 11 existing personas completed without errors and with stable response hashes. Each concurrency setting had 33 reads: p95 was 445ms at concurrency 1, 166ms at concurrency 3 and 198ms at concurrency 5. Evidence: `outputs/sep12-performance/wms-roles-c285863-sep14/api.json`. This small read-only sample does not establish transaction throughput, isolated-role authority or maximum capacity, and is not relabeled as a measurement of `9e67f47`.

## Remaining Scope

Isolated-role provisioning remains offline reviewed only; seven proposed identities and their live journeys have not been executed. Broader receiving exceptions, stock types, return dispositions, concurrency/recovery, exact-step archived screenshots and actual hardware/user acceptance remain open. SMTP remains excluded. Earlier archived cleanup and retained transaction evidence keep their original run/build identities.
