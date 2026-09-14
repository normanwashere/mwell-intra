# September 14 - Receiving Practice And Sourcing Recovery

## Release Status

Released to live UAT as `b3b74983c7260d5b0ff3a2049b94c67d10e3d0be`, deployment `dpl_AmfaWxunJGh9gDMQr7uQC5B5nFjC`. Canonical health verified the commit, UAT environment and `kkoitlvydytdhlpxhuah` at 02:29 UTC on September 14. SMTP is excluded. This note does not certify the complete WMS or a human pilot.

## Changes

- Receiving practice records its saved-draft checkpoint at receipt review. Learners no longer need to pause just to satisfy this checkpoint. Final submission, required evidence and controlled quality routing remain mandatory.
- Emergency-access wording now says approval is required. It does not imply that access has already been granted.
- Procurement verifies sourcing state before requesting event-specific reads. A confirmed request without a sourcing event shows the valid not-started state; a failed read offers Retry sourcing.
- KB, the standalone manual, training guidance and technical specification explain these changes.

## Evidence

The live isolated Warehouse Operator completed five of nine assigned requirements on build `f8d437d`. Receiving practice then stopped because attempt `9eddf857-a376-4e03-b034-10c4ee3ac326` contained a validated `complete` checkpoint but lacked the published `draft-saved` checkpoint. Its status remained `in_progress`; it was not manually certified or resubmitted.

Local checks: 1,103 Warehouse tests, 299 Learning tests and 377 Procurement tests passed. Three new receiving regression cases failed before the adapter fix and passed afterward. The emergency-access copy regression also failed before its fix. Warehouse, Learning and Procurement typechecks passed; 56 handbook/release-documentation tests passed. These are local results, not live completion evidence.

After deployment, the same learner used Back to return to evidence review and confirmed the condition through the normal UI. The server recorded the missing `draft-saved` checkpoint with outcome `ready_for_review` and completed the original attempt at 02:29:52 UTC, because its earlier validated submission was already recorded. No direct certification write or second receipt submission was used. The refreshed live checklist showed **6 of 9 complete** and an active Receive Stock certification. This is recovery evidence, not a fresh uninterrupted attempt. The other three required exercises remain open.

Desktop 1440x900 and mobile 390x844 screenshots of the same resumed learner were visually reviewed, not separate completion runs. The updated emergency-access wording is visible. Remaining UX findings: the expanded task picker and long role list push mandatory progress below the first viewport; its nested scrolling makes reaching the checklist awkward. Long desktop Start labels also squeeze task titles. These captures do not certify every role, screen or control.

## Still Open

A fresh uninterrupted receiving attempt; the remaining exercises and all seven isolated-role journeys; later-stage sourcing authority and the sourcing fix's own live retest; task-picker/checklist ergonomics; remaining warehouse transactions and desktop/mobile certification; real-user and physical-device testing. Existing test records are retained for reconciliation, not recreated to bypass a failed step.
