# September 14 - Receiving Practice And Sourcing Recovery

## Release Status

Candidate: local regression verified; deployment and live retest pending. SMTP is excluded. This note does not certify the complete WMS or a human pilot.

## Changes

- Receiving practice records its saved-draft checkpoint at receipt review. Learners no longer need to pause just to satisfy this checkpoint. Final submission, required evidence and controlled quality routing remain mandatory.
- Emergency-access wording now says approval is required. It does not imply that access has already been granted.
- Procurement verifies sourcing state before requesting event-specific reads. A confirmed request without a sourcing event shows the valid not-started state; a failed read offers Retry sourcing.
- KB, the standalone manual, training guidance and technical specification explain these changes.

## Evidence

The live isolated Warehouse Operator completed five of nine assigned requirements on build `f8d437d`. Receiving practice then stopped because attempt `9eddf857-a376-4e03-b034-10c4ee3ac326` contained a validated `complete` checkpoint but lacked the published `draft-saved` checkpoint. Its status remained `in_progress`; it was not manually certified or resubmitted.

Local checks: 1,103 Warehouse tests, 299 Learning tests and 377 Procurement tests passed. Three new receiving regression cases failed before the adapter fix and passed afterward. The emergency-access copy regression also failed before its fix. Warehouse typecheck passed. These are local results, not live completion evidence.

## Still Open

Live post-deployment receiving recovery and a fresh uninterrupted attempt; all seven isolated-role journeys; later-stage sourcing authority; remaining warehouse transactions and desktop/mobile certification; real-user and physical-device testing. Existing test records are retained for reconciliation, not recreated to bypass a failed step.
