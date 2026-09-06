# Task-first Learning and Knowledge Base

Status: local candidate, not a live release or human usability certification.

## Delivered behavior
- Home, Knowledge Base and learning share a role-filtered task entry with at most three suggestions. Suggestions do not grant authorization.
- Selected tasks persist in the URL. The task chooser collapses after selection; exact prerequisite learning appears before overall progress.
- Other mandatory requirements and optional guidance remain accessible. Existing versions, assessments, policy acknowledgment, server authority and record checks remain in force.
- The KB's former browser-local orientation completion is replaced by advisory guidance linking to governed learning.
- Contextual help preserves mounted forms and file inputs, offers a full-guide fallback, and uses audience-filtered server content.
- Feature guides prioritize prerequisites, existing decision flows, controls/evidence, outcomes, handoffs and recovery before reference details.
- The KB landing has compact task/role/feature navigation, a quieter search surface, and higher task placement. Desktop and mobile layouts retain accessible controls.
- Return-path normalization rejects control-character and encoded redirect bypasses.
- Manuals and standalone HTML have been updated to describe the candidate rather than imply it is live.

## Verification
- Final production build and TypeScript passed after the search and return-path refinements.
- Final KB/component/API run: 380 passed, one pre-existing browser-only test skipped. The fixed 55-query search benchmark passed within that run.
- Learning suite: 238 passed; subsequent sanitizer and center regression: 101 passed, including seven added sanitizer cases.
- Selected-task browser journeys: 22/22 passed for 11 canonical test personas at desktop 1440 and mobile 390. The task endpoint was controlled with actual catalog-derived fixtures for these UI cases.
- Unmocked local task endpoint, dark theme, invalid task, training opening/resume and KB recovery: 2/2 passed at desktop 1440 and mobile 320.
- Older onboarding/contextual-help regression: 48/50 in one run; two mobile cases exceeded the unchanged 30-second timeout. Both passed unchanged on isolated rerun in 6.9 and 7.6 seconds. This is not a single clean 50-case run.
- Visual captures are in outputs/task-first-learning. Desktop and mobile Operations captures were opened and reviewed; compacted the chooser and KB entry after that review. Full-page images include fixed navigation at its viewport position; viewport captures are preferable for sharing.
- Endpoint security and optional telemetry checks are separately tested. Telemetry collection remains disabled and its migration is unapplied.
- A production-runtime demo attempt correctly stopped at Configuration missing because no live Supabase configuration was supplied; its two failed demo assertions are not live behavior evidence. The safeguard was preserved and the local development preview restored.

## Remaining acceptance work
- Real new-user pilot using the training protocol; no claimed usability score or unassisted-completion rate.
- Exact live deployment, database/curriculum publication and live certification remain separate release steps.
- Existing screenshots are retained, but a per-control evidence audit remains outstanding: the coverage inventory does not certify all 271 live controls with exact matching hotspots.
- Task suggestions are curated role-based choices, not a claim to be ranked from live assigned transaction queues. Queue-driven recommendations and cross-device resumable-task preference remain further work.
- Telemetry instrumentation, retention scheduling, reporting and enablement require the documented privacy and deployment controls.

See task-first-coverage.md for the precise content inventory and gaps. Do not interpret local screenshots as live transaction evidence.
