# Onboarding UAT Result - September 7, 2026

## Live State

UAT: https://mwell-intra-uat.vercel.app

Runtime: `06c9b80bc6c09c343800756ebcadc0efdb88619f`. Final health readback at `2026-09-07T04:08:05.353Z` confirmed healthy UAT and Supabase project `kkoitlvydytdhlpxhuah`. Production was not changed.

Four reviewed curriculum revisions are published and active: Warehouse Operator, Procurement Finance, Procurement Admin, and Vendor Portal. Seven new requirement roots preserve existing published training and evidence. Existing role permissions were not expanded. Independent agents reviewed content and exact database scripts under the user's explicit authorization; records identify this as automated review, not human sign-off.

## Verified Results

| Check | Result | Scope |
| --- | --- | --- |
| All-role public UAT task sweep | 22/22 role/viewport cases; 108/108 navigation and readiness checks passed | Eleven account types, desktop and mobile, normal service workers, no business writes |
| Vendor after its activation | 2/2 viewport cases; 6/6 task checks passed | New vendor mapping, separate from the earlier sweep |
| New internal simulations | 8/8 cases passed | Four fresh desktop completions with wrong-answer rejection, three accepted choices, saved completion and reload; four mobile completion readbacks |
| Vendor learner flow | 4/4 cases passed | Fresh attestation saved both checkpoints; existing practice completion was read back, not newly earned; mobile persistence checked |
| Learning unit suite | 267 passed | Includes exact content hashes, server-only choice rules and unchanged prior catalog bindings |
| Publication SQL | All four live rollback rehearsals and separately approved publications/activations succeeded | Immutable prior content retained; no fabricated learner completion |
| Test harness guards | 8 passed | Exact UAT target and scoped learning writes; no business or legal actions |

All owned test browser contexts closed. Actual learner writes were limited to existing synthetic UAT accounts. No stock, purchase order, payment, vendor application, signature or accreditation record was changed by these tests.

## Evidence

- [All-role results and 216 screenshots](../../outputs/task-first-candidate/smoke-allow-2026-09-07T03-44-54-736Z/REVIEW.md)
- [Post-activation vendor review](../../outputs/task-first-candidate/smoke-allow-2026-09-07T03-57-06-316Z/REVIEW.md)
- [Actual internal learner results](../../outputs/task-first-candidate/live-learning-2026-09-07T03-57-25-355Z/results.json)
- [Actual vendor learner results](../../outputs/task-first-candidate/vendor-live-learning-2026-09-07T04-04-59-366Z/results.json)
- [Independent publication review and exact SQL](2026-09-07-publication-bindings/README.md)
- [Full chronology and limitations](2026-09-07-AUTOMATED-PUBLICATION-PROGRESS.md)

The earlier browser-response-fixture experiment hit its intentional write boundary and is not counted as live scenario certification. The later actual learner tests above replaced that missing execution evidence.

## Remaining Work

1. **P2 presentation:** the expanded vendor checklist has two distinct completed practice roots with the same title. Make previous/current completion labels clearer without rewriting published requirements or resetting earned credit.
2. **Screenshot certification:** captured image hashes were checked and selected images visually reviewed, but all 271 controls have not received exact-step visual certification. This report is not a claim that every captured image was manually reviewed.
3. **Usability evidence:** no human pilot was conducted. Automated review and test accounts provide reproducible engineering evidence, not observed human usability results.

The standalone handbook includes the reviewed task-training reference. Git commits are local; no GitHub push is claimed by this report.
