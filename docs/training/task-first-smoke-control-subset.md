# Protected Candidate Smoke: Exact Control Subset

Protected candidate: `39a509cab9a769c1b1c611fa9decd55d0b02c454`, `https://mwell-intra-6ena7ruqm-normans-projects-d718ecb1.vercel.app`. Main reports healthy deployment on the correct UAT project. Public alias remains baseline `7083373`, pending genuine vendor review. No timestamp is invented for main's health report.

Einstein owns the running candidate smoke and its captures in `outputs/task-first-candidate`. Independent assistant visual review is allowed and is not human-pilot evidence. This mapping task has opened two Administrator KB images as recorded below; neither has been promoted to complete control certification. All 271 manifest rows remain `notcaptured`.

## Eleven In-scope Inventory Controls

Eligible role and capability arrays for every ID remain in the [full manifest](task-first-certification-manifest.json). Internal onboarding excludes the vendor role; vendor onboarding requires `vendor_portal`; KB includes authorized internal roles and vendor-scoped readership. Use the real authenticated projection, not a persona label as authorization.

| Exact existing control ID | Actual target / state to verify | Smoke mapping and remaining evidence |
| --- | --- | --- |
| `knowledge-library:Search handbook` | `/knowledge`, `#knowledge-search`, searchbox named `Search all handbook content`; empty value | Best exact target candidate in `*-knowledge.png`. Smoke visits `?mode=task` but does not explicitly assert this target. Need both actual images opened, exact visibility/unmasked state and provenance. Empty-state instruction only; search filtering behavior not exercised |
| `knowledge-library:Filter role` | Source consumes a role URL parameter; no role-select target located in the inspected current HandbookLanding render | Do not substitute the Roles mode/tab or persona-directory navigation for role-result filtering. Exact control source/layout mapping remains unresolved |
| `knowledge-library:Filter module` | Module-labelled select in HandbookLanding; appears when query, active filters or mode other than task | Smoke's empty `?mode=task` does not expose this filter panel. Needs a separate approved navigation state such as the existing feature/role mode, then exact target capture |
| `knowledge-library:Filter content type` | Existing documented article/workflow/glossary/future result filter | No corresponding type-selector located in inspected current landing render. Modes and Availability select are not equivalent. Exact source/layout mapping unresolved; not certified by a general KB screenshot |
| `knowledge-library:Open contextual guidance` | Exact operational page help -> matching feature guide | Smoke's selected task `View guide` is not operational contextual help. Needs source page identity and exact help destination evidence |
| `role-onboarding:Start or resume requirement` | Assigned curriculum item in `/onboarding`, effective scoped assignment | `Prepare for task` selects a task; it does not start a learning requirement. Task chooser/selected images are supplemental only. No actual learning start/completion exercised |
| `role-onboarding:Refresh status` | Explicit stale/failed assignment refresh control | Page reload preserving task selection is not this recovery-control test. Needs actual control and approved stale/failure state |
| `role-onboarding:Open support guidance` | Recovery guidance with needs-support requirement or locked capability | Generic `View guide` does not satisfy this prerequisite. Needs the exact support-state target; no forced failures or assignment changes allowed here |
| `vendor-onboarding:Start or resume vendor requirement` | Assigned vendor curriculum item at `/vendor/onboarding` | Vendor task selection is supplemental, not a requirement start. Requires genuine vendor state and exact assigned item; no completion claim |
| `vendor-onboarding:Return to vendor portal` | Read-only return link to the vendor's own portal from vendor onboarding | Safe navigation approved by main. Smoke goes from task selection to KB; it does not exercise this return link. Separate target/path observation needed |
| `vendor-onboarding:Sign out` | Isolated vendor-header session action | Outside routine capture activation approval. Context teardown is not sign-out control evidence. Observe only unless main separately authorizes the session action |

## Smoke Coverage That Must Stay Separate

The inspected `scripts/qa/task-first-live-smoke.mjs` validates authenticated task projection, Prepare for task, selected task/next URL retention, change-task/reload, exact selected guide href and general KB navigation. It captures chooser, selected, change-task, guide-top, guide-scroll and knowledge states. These may support supplemental task-first candidate acceptance once actual results and images are reviewed; they do not automatically map to an original control with a different semantic contract.

No new canonical controls are invented to absorb these screenshots. The baseline all-complete onboarding state and the smoke's `freshLearningCompletionTested: false` cannot establish fresh-user learning or a human pilot. Existing empty search/navigation states are approved by main and do not need another business-owner approval. Business records, exhausted-attempt states, fault injection, signatures and writes remain outside that approval.

## Review Handoff

### Independent Assistant Image Review

Opened actual Administrator images: desktop 1440x900 `outputs/task-first-candidate/platform_administrator-desktop-1440-knowledge.png` (SHA-256 `caa8dffe58a04b7da18a167ebe825e7ce4de8890ea8e659ecda3cd03ef3af3df`) and mobile 390x844 `outputs/task-first-candidate/platform_administrator-mobile-390-knowledge.png` (SHA-256 `090a8742f3b60c1a8d1451bfdea1e6b7fb0dd891c86959fbddb6aa5a499ddbda`). Review performed by the independent reporting assistant, not the user or a human pilot participant.

Both show the empty, unmasked search field in the KB task view with the Administrator context. Desktop shows the full example placeholder. Mobile visibly truncates that example within the input; do not claim full example-instruction legibility on mobile. This is scoped visual observation for `knowledge-library:Search handbook`, not tested search-result filtering. Exact locator match count and per-image capture/health timestamps are not supplied by this broad smoke artifact, so they are not invented to satisfy the run validator.

At review time `smoke-results.json` was unfinished and its first twelve recorded cases were failed: Administrator/Vendor cases had recorded browser/network errors, most internal cases timed out waiting for Task learning, and Operations Lead timed out on change-task. Root cause remains with Einstein/main, not classified here as application versus harness failure. Preserve these failed attempts and do not infer a smoke pass from the two readable search images.

1. Await smoke results with exact before/after candidate identity and per-case capture paths/context closure. Preserve failed/partial attempts.
2. Independently open the exact desktop/mobile knowledge images for the first eligible persona. Confirm the search target is visible, empty, legible and not masked; do not infer it from filename or a heading assertion.
3. Link only `knowledge-library:Search handbook` if the exact observed state qualifies. Record digest, dimensions, capture identity/time, route/state and independent review in a separate run artifact; absence of these fields remains explicit rather than fabricated.
4. Keep the other ten IDs unexercised or mapping-unresolved as listed. Send the two unresolved filter semantics to main/content ownership for confirmation; do not edit application/catalog files from this reporting scope.
5. Retain `reviewed-instruction-only` as a scoped result, never all-271, transition, user-approval or human-pilot certification.
