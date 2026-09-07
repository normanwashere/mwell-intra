# Automated Review and UAT Publication

## Authority and Attribution

On September 7 the user explicitly requested independent agent review instead of named human owners/reviewers. This authorizes an automated content-review process for these UAT corrections. It is not human sign-off, a real-user pilot, or production release approval.

Content author: Curie (`01a06fa0-d12a-73d0-a143-5e6c7f3a745e`). Independent reviewer: Maxwell (`01a06fa2-a909-7bd0-84a1-90c820ec9c5f`). Publication preparation: Godel (`01a072be-8370-7621-8090-b3b44baa8cc6`). Main orchestrator controls live execution and target checks.

Any UAT account IDs in publication records must be identified as technical custodian references, not people who performed the automated review. Exact content hashes, reviewer verdicts, source references and the user's authorization must accompany the change. Failed review versions stay in the record. Existing immutable training versions and user evidence must not be rewritten.

## Protected UI Deployment

- Source commit: `5aaf7eb49a7e6a7c1e7b2a777816b2d6ec3260da`.
- Deployment: `dpl_BRFac7wPQHv7pux6Nhw1niCtotd3`.
- URL: https://mwell-intra-6it3u4uze-normans-projects-d718ecb1.vercel.app
- Deployed from a clean Git archive, excluding unfinished local training candidates and optional telemetry changes.
- Vercel build, TypeScript and static generation passed.
- Health verified at `2026-09-07T03:02:28.910Z`: exact commit, UAT `kkoitlvydytdhlpxhuah`, reachable database/assets, configured Supabase auth.
- Public `mwell-intra-uat.vercel.app` was separately verified healthy on `708337392364b7ab2b243e3237bf0604e1cc9db4`; no public promotion.
- CLI warned that the supplementary `DEPLOYMENT_COMMIT_SHA` was not passed through Turbo. The supported `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` identified the correct build and was confirmed by health; no unknown commit claim is made.

## Review Work

Existing inspection/payment training does not fully cover the missing capabilities. New scenario IDs and content are being reviewed, rather than attaching extra capability outcomes to insufficient old training.

The independent reviewer rejected inspection wording that equated a failed response with an unrecorded decision. Lost responses have unknown outcomes; the corrected instruction must require authoritative readback before retry or handoff. Runtime registration and publication remain pending final exact-hash approval.

## Registered Training Candidate

- Independent review approved the corrected inspection and payment scenarios, with answer keys kept server-only.
- Source commit: `9c9bef1aa71a02b9ea0f9e391472d7ee09cc817f`.
- Protected URL: https://mwell-intra-br42ko1vh-normans-projects-d718ecb1.vercel.app
- Deployment: `dpl_Bf7qNfSdWxHYC36uYEjfRU5q7RSJ`.
- Health verified at `2026-09-07T03:23:50.758Z`: exact commit, UAT project, reachable database and static assets.
- All 264 learning tests passed before deployment. Registration does not assign or certify learners.
- No curriculum publication or public-alias promotion is claimed here.

## Completed All-Eligible-Task Sweep

The previous protected UI commit `5aaf7eb` completed 108 task cases across 11 account types on desktop and mobile. All 108 navigation/reload checks passed. Readiness had 98 passes and 10 failures, with no unexecuted tasks. This is not a full pass.

Failures on both viewports were Operations Associate receiving/inspection, put-away, and pick-and-pack, plus payment readiness for the Procurement and Finance test personas. New put-away and pick-and-pack content is under separate independent review; it is not yet registered or published.

Evidence: `outputs/task-first-candidate/smoke-allow-2026-09-07T03-03-08-908Z/`. The run verified 216 screenshot hashes. Five selected images were visually reviewed; this does not certify every screenshot or all 271 control-level captures. No business transactions, learner resets, or role grants were performed by this sweep.

## Publication Safety

The old public runtime does not recognize the new scenario IDs. Publication preparation therefore separates inactive content publication from role-mapping activation. Activation must follow compatible public-runtime verification, exact SQL review, and rollback rehearsal. Existing published versions and learner evidence are preserved.

Independent review caught an outcome-key mismatch in the publication renderer: the API records accepted choice IDs, not instructional checkpoint labels. The corrected renderer must be tested against the exact server rules before execution. Automated review does not substitute for a real-user usability pilot.

## Live Publication and UAT Promotion

The corrected renderer passed all five focused tests, including real SQL enforcement for all twelve accepted choices across the four simulations and rejection of wrong choices. Independent review approved the exact rollback SQL for each of the three internal curricula. All three rehearsals succeeded against UAT, and a subsequent query confirmed zero remaining v2 curricula and zero additive roots after rollback.

Following separate exact-SQL execution approval, all three internal v2 curricula were published inactive. Readback confirmed all five new requirements published and zero role mappings to the new versions. The warehouse curriculum retains its original members and adds inspection, put-away and pick-and-pack; Finance and Procurement Admin each add scoped payment-readiness training. This is content publication, not learner completion.

The final compatible runtime is `06c9b80bc6c09c343800756ebcadc0efdb88619f`, deployment `dpl_EbgQ2roc6bfx2U1EwJyN32eHGdyt`. Its build and TypeScript checks passed. Public `https://mwell-intra-uat.vercel.app` was promoted and independently read back at `2026-09-07T03:39:16.161Z`, confirming this exact commit, UAT database and healthy assets/auth configuration. Production was not changed.

Evidence is in `docs/audits/2026-09-07-publication-bindings/`: exact review inputs, SQL, independent execution approvals, live rollback/publication results and public health. Role activation and post-activation live verification are still separate pending steps at this checkpoint. Vendor publication is also still pending its independent review.

## Activation and Completed Live Sweep

The three internal role mappings were activated and read back between `03:43:55Z` and `03:44:01Z`. Each activation had independently reviewed exact SQL, a successful live rollback rehearsal, and separate execution approval. Old mappings, published versions and learner evidence remain intact.

The unmocked public-UAT sweep completed at `2026-09-07T03:54:29.102Z`: 22/22 role/viewport cases passed, with 108/108 navigation checks and 108/108 known-readiness checks. It covered all eleven account types on desktop and mobile. The ten earlier readiness failures no longer appeared. All 216 screenshot hashes were verified; three selected images were manually visually reviewed by the testing agent, not all 216. Navigation-aborted requests remain recorded in the raw evidence and were not treated as proof of product failure. All browser contexts closed.

Evidence: `outputs/task-first-candidate/smoke-allow-2026-09-07T03-44-54-736Z/`. The run did not complete training, reset learners or perform business transactions. Known readiness is not the same as completed training. Actual new-scenario completion tests are a separate run.

Vendor publication required another correction: retaining the old practice root while changing its prerequisites produced conflicting definitions. The reviewed fix adds a distinct practice root with the existing practice content, preserving the old graph. Actual database and readiness-projection tests passed before live rehearsal/publication. The vendor v2 mapping was activated at `2026-09-07T03:56:33.504601Z`; readback confirmed both the preserved v1 and new v2 mappings. Targeted vendor desktop/mobile verification is running after activation, since the earlier sweep tested the old vendor mapping.

## Post-Activation Evidence

Targeted vendor verification completed at `03:57:33.703Z`: 2/2 viewport cases and 6/6 task navigation/readiness checks passed. Twelve screenshot hashes were verified. Supplemental expanded-checklist checks confirmed no 390px horizontal overflow. The server retained equivalent practice completion; this run did not earn that completion. The new evidence attestation remained not started. The expanded list shows two distinct practice requirements with identical titles, leaving a minor historical/current labeling ambiguity for later UI improvement.

Actual internal learner verification exercised all four new scenarios on the existing synthetic Operations Associate and Finance accounts. Each desktop case started fresh, rejected one wrong answer without advancing, accepted three correct choices, completed and survived reload. Mobile then verified all four completed states without resetting or repeating attempts: 8/8 cases passed. These are genuine application-recorded test-account learning events, not human competence evidence. No warehouse, procurement, payment, accreditation or other business transaction was performed.

Actual learner evidence: `outputs/task-first-candidate/live-learning-2026-09-07T03-57-25-355Z/`. Service workers were blocked in this narrowly guarded write test to enforce its request allowlist; the separate 108-task unmocked sweep used normal service workers. Do not conflate the two test modes. Vendor attestation completion is being checked separately.

## Final Vendor Learner Check

The actual vendor learning run passed all four desktop/mobile cases with eight screenshots and zero blocked requests. The fresh evidence attestation recorded both checkpoints and completed in one attempt; completion survived reload. The practice was already passed with zero attempts through server-reported equivalent credit, so it was read back only and is not claimed as a new completion. All browser contexts closed. No resets, business mutations, legal declarations, signatures or accreditation decisions were performed.

Evidence: `outputs/task-first-candidate/vendor-live-learning-2026-09-07T04-04-59-366Z/results.json`. The guarded learner harness passed five local safety tests. All four committed publication rehearsals reproduce byte-for-byte; scoped Git LF attributes preserve the recorded review hashes across checkouts.

## Remaining Limits

- Expanded vendor learning displays two completed practice roots with the same title. Historical/current labels should be clearer; this is a P2 presentation issue, not a conflicting requirement or an extra outstanding step.
- The full 271-control exact-step screenshot certification is not completed by these targeted captures. Hash verification is not visual review.
- Automated accounts and independent agents do not constitute a real-user usability pilot. The user's approval authorizes automated content review, not a claim that human participants were observed.
- These changes and validations target UAT. Production was untouched. Git commits are local; no GitHub push is claimed in this report.
