# Exact Control Capture Preparation

Candidate status: main reports protected deployment `39a509cab9a769c1b1c611fa9decd55d0b02c454` healthy on the correct UAT project. Public alias remains `7083373`, which is explicitly rejected as candidate evidence. No browser, authentication, capture, business write or deployment was performed by this preparation task. See the [KB/onboarding smoke subset](task-first-smoke-control-subset.md).

## Bounded Mapping

The [271-row manifest](task-first-certification-manifest.json) maps every existing live documented control to routes, eligible role IDs, capability requirements, prerequisites, expected result and recovery. These are 271 controls, not an invented linear 271-step workflow. Each new `capturePlan` records role eligibility, unresolved actor/target binding, safe observation scope and a conservative safety category. All rows remain `notcaptured`; all `activationAllowed` values are false.

| Safety category | Controls | Allowed preparation |
| --- | --- | --- |
| Navigation or local view, review required | 89 | Bind the exact source handler/route and owner-prepared state; no assumed permission to click |
| Read recovery requiring fault fixture | 5 | Identify an authorized failure fixture; do not inject failures or reconnect queued work now |
| Destructive, prohibited | 18 | Observe existing control or disabled state only; never cancel, delete, discard, reject or revoke |
| Identity/authority, main only | 10 | Main owns approved identity setup; no grants, password/reset actions or invitation sending |
| External I/O or sensitive, prohibited | 22 | Observe prepared control without upload, export, download, camera/scanner or signature activation |
| Write or unresolved, prohibited | 127 | Default deny activation; process owner resolves whether opening is local or persists state |

This is exact-name safety triage, not proof of every handler's effects. The existing runner is scenario-driven and uses a broad page-text first-match wait; it is not an exact-control executor. It remains unchanged. Existing target-name candidates are retained as candidates only. This preparation does not fabricate locators for unresolved controls or claim the old runner can capture all 271 safely.

Main approves routine empty search and read-only navigation states; these require no separate business-owner fixture approval. Exact approved routine IDs have `fixtureRequired: false` and `routineUiApproval` in the manifest. A state description is still required, and unknown targets are not invented. Other controls retain their approved fixture requirements. The documentation owner field is not necessarily the acting business role; use eligible roles plus live authorization and prerequisite checks. A listed role alone never grants permission. The assigned actor remains null until main coordinates it. `activationAllowed: false` means this generic preparation tool cannot auto-click; it does not rescind main's approval for supervised routine UI navigation.

## Capture Contract

1. Main freezes and deploys the candidate, records its full 40-character SHA and matching live health SHA/time. Never substitute the baseline commit.
2. Process owner binds each control to the actual route, exact state and approved fixture. Confirm source semantics and unique accessible role/name or stable scoped locator. Do not use a nearby heading, an arbitrary first match or a fabricated selector.
3. Main prepares the authorized state. This read-only plan permits only observation, scrolling and screenshots after candidate approval. Controls that require writes to reach a result remain blocked/unexercised until separately authorized fixture work. No generic runner is permitted to execute the business action.
4. Capture desktop and mobile separately, recording actual dimensions, one exact target match, visible/unmasked target, state, full commit, capture identity/time and image SHA-256. Do not persist account identifiers, passwords, session state, real serials or business payloads in this record.
5. Preserve every attempt, including failures; select exactly one attempt per viewport for review. Selection does not erase earlier failures.
6. An independent reviewer opens each selected image and records target legibility, correct context, privacy, clipping/overlap, exact digest and candidate commit. No self-review, filename-only promotion or masked target acceptance.

## Reusable Local Tools

The tools do not launch browsers or make network calls. The existing capture runners are not invoked.

```sh
node scripts/qa/task-first-certification-manifest.mjs --check
node scripts/qa/task-first-control-run.mjs --init outputs/task-first-control-run.json
node scripts/qa/task-first-control-run.mjs --check outputs/task-first-control-run.json
node --test scripts/qa/task-first-control-review.test.mjs scripts/qa/task-first-control-run.test.mjs scripts/qa/task-first-certification-manifest.test.mjs
```

`--init` creates 271 blank rows and refuses to overwrite an existing run. No run was initialized as observed evidence during this task. `--check` requires every exact control ID once, rejects unknown/duplicate/missing rows, reads only local PNG/JPEG paths within the repository, and compares selected image bytes to recorded digests. It exits nonzero for any incomplete or blocked row. Run outputs are separate from the regenerable planning manifest.

Each run row has candidate/health metadata, approved actor role and state/fixture references, an actual route plus declared route template, and an `attempts` array. Each selected attempt records `viewport`, `path`, `sha256`, `capturedAt`, `capturedBy`, `commit`, `width`, `height`, `locator`, `matchCount`, `targetVisible`, `targetMasked`, `exactStateConfirmed` and `businessWritesObserved`. Review fields are `disposition`, `openedImage`, `targetLegible`, `contextCorrect`, `privacySafe`, `noClippingOrOverlap`, `sha256`, `candidateCommit`, `reviewedBy`, and `reviewedAt`. These fields must reflect actual observations, not values filled merely to pass validation.

States: `notcaptured`, `blocked`, `captured-unreviewed`, `review-rejected`, `reviewed-instruction-only`. The last state is deliberately not business certification or human pilot completion. The checker validates metadata consistency and file digests; it cannot authenticate reviewers, inspect pixels, verify live RLS or independently establish that an attestation is truthful. Those remain the main/process/independent-review responsibilities.

## Remaining Release Work

- Protected candidate deployment and main-reported health are available; capture-run health metadata must bind to the exact protected candidate. Public alias promotion remains pending genuine vendor review.
- Unique target bindings, actual actor assignment and safe fixtures are pending for all rows. The 17 existing registry label matches still need scope verification.
- Fresh candidate desktop/mobile target captures and independent review are pending. No all-controls screenshot-complete claim is made.
- Business transitions, destructive actions, signatures and effects on external systems are outside this read-only scope; safe state visibility cannot stand in for their completion evidence.
- Human participants, scheduling, consent and actual pilot results remain pending under the separate pilot protocol.
