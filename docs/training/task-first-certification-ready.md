# Task-first Capture Certification Readiness

Status: planning only. No new capture, authentication, app modification, business write or certification was performed by this inventory task. The integration lead owns candidate deployment, health verification and authenticated review. A pending build cannot be certified by historical images.

## Inventory and Reuse Boundary

[Machine-readable manifest](task-first-certification-manifest.json) contains exactly 271 executable control rows from 59 live features; nine roadmap controls are excluded. The source inventory has 53 evidence records, not 53 individual image files: 106 distinct desktop/mobile artifact paths exist locally. File existence is not visual review, freshness or certification. All 271 rows remain `notcaptured`, with null candidate SHA, capture paths and reviewer fields. Exact feature/control hotspot matches: zero.

Each row identifies the existing feature/control name, authorized route candidates, role/capability requirements, documented prerequisite, behavior, expected result, recovery and policy references. These are the actual source-defined targets, not invented accessible selectors. Historical evidence IDs link to their original state, landmark, hotspot instruction, commit and repository image paths in the same manifest. Related-flow/route evidence is contextual only and must not be promoted to exact-control evidence.

Seventeen control names have exact name candidates in the existing handbook target registry. The manifest preserves that registry's role, names, selector/preparation metadata where present, but marks scope unverified: the same label may occur on another route or task. The other 254 controls require an explicit per-control target binding or documented confirmation that an existing scenario covers the exact state. No `.first()` or arbitrary coordinate fallback is acceptable. A null locator means unresolved, not that the control does not exist.

## Existing Tooling

### Actual Baseline Limitations

The baseline captures in `outputs/task-first-live-baseline/desktop` are not per-control certification. Assistant-reviewed baseline: main visually inspected `desktop-1440-platform-administrator-knowledge-allowed-frame-01.jpg` through a tool image and observed that the harness masks all inputs in magenta, including blank search. This is **privacy redaction, not an app UI defect**. A masked target cannot demonstrate its instructional appearance or exact input state. This report records main's assistant review; it claims neither user review/acceptance nor independent inspection of every baseline image.

Reported public live baseline SHA: `7083373`. This identifies the unchanged public alias only. Main now reports protected candidate `39a509cab9a769c1b1c611fa9decd55d0b02c454` deployed and healthy at the separate URL recorded in the manifest. Main supplied no exact health timestamp, so that field remains null pending capture-run evidence. Do not use the baseline SHA as candidate deployment evidence. Main approves routine empty search/read-only navigation states without a separate business-owner fixture; other fixture and write boundaries remain unchanged.

Blocker `masked-target-controls`: main must approve a privacy-safe target-visible capture without sensitive values before any affected control can be certified. Preserve the redacted baseline; do not remove privacy safeguards or fabricate a replacement. No baseline image is added to an exact control match or certified count by this update.

Blocker `existing-user-not-fresh-pilot`: all-complete onboarding demonstrates only an existing user's state. It proves neither a fresh-user journey nor first-time human usability. Recruitment, scheduling and actual participant results remain pending. All 271 certification rows remain `notcaptured`; baseline screenshot availability does not change that status.

| Tool | Reusable part | Limitation |
| --- | --- | --- |
| `scripts/qa/knowledge-evidence-catalog.mjs` | Existing evidence requirements and semantic target keys | Metadata gate, not pixel or current-control certification |
| `scripts/qa/capture-knowledge-evidence.mjs` | Existing scenario preparation and desktop/mobile capture; `EVIDENCE_ONLY` selects its named capture | Scenario-driven, not a 271-control runner; includes authentication and possible state changes. Do not execute under this read-only assignment |
| `scripts/qa/handbook-evidence-targets.mjs` | Existing exact roles/names, contextual selectors and preparation identifiers | Stage-level bindings; matching a name alone does not establish control/route identity |
| `scripts/qa/capture-handbook-stage-evidence.mjs` | Approved task-stage capture and provenance workflow | Requires exact approved UAT, commit and certification run; may prepare state. Main must review and authorize before execution |

Inventory-only commands (no browser/network/business writes):

```sh
node scripts/qa/task-first-certification-manifest.mjs
node scripts/qa/task-first-certification-manifest.mjs --check
node --test scripts/qa/task-first-certification-manifest.test.mjs
```

The generator writes only the planning JSON and deliberately resets all rows to `notcaptured`. Store actual future run results in a separately versioned run artifact referencing control IDs; do not overwrite observed results by regenerating this planning baseline. Freshness compares the current content/tool registry to the baseline. It does not confirm deployment.

## Main-led Capture Checklist

The [exact-control capture preparation](task-first-exact-control-capture.md) now supplies conservative per-control safety categories and a separate run/review validator. It does not enable business actions or upgrade planning statuses.

- [ ] Integration lead records the frozen source SHA, successful build, exact UAT health SHA and authorized environment. Do not infer these from historical evidence commits.
- [ ] Process owner assigns each control's exact route, authorized persona and synthetic state/fixture reference. Dynamic record IDs and form contents stay out of shared artifacts.
- [ ] Capture owner resolves unique scoped semantic role/name or stable field locator. Confirm it targets the control, not a nearby heading, help icon or unrelated same-label action.
- [ ] Mark whether the required observation is read-only. State transitions, submissions, approvals, uploads and cleanup need separate explicit authorization; leave those clauses unverified in this read-only run.
- [ ] Main authenticates approved actors. Do not serialize credentials, storage state, tokens or account identifiers into the manifest.
- [ ] Capture the exact prerequisite/decision state at approved desktop and mobile viewports on the frozen build. Include negative, disabled, result and recovery states only when actually exercised or observed.
- [ ] Open both images and check target legibility, clipping/overlap, state identity, source/owner context and sensitive-data exposure. Keep failures and retries as distinct attempts.
- [ ] Independent reviewer records actual capture SHA, timestamp, viewport, artifact path, scope and disposition in the run artifact. Screenshot visibility alone does not prove mutation success, policy enforcement or persistence.
- [ ] Reconcile each exact acceptance clause. Leave uncaptured, blocked or unexercised clauses visible; neither historical screenshots nor green CI certify all controls.

## Human Pilot: Who and When

No participants have been recruited or scheduled in these materials. Named organizers, actual dates and consent approvals are pending human assignment; agents cannot supply human results.

| Responsibility | Proposed accountable role | Named assignee | When / exit condition |
| --- | --- | --- | --- |
| Recruit first-time participants | Training coordinator | Pending assignment | Before scheduling; target 22 people across eleven personas |
| Approve scenario and fixture | Each business process owner | Pending assignment | Before each session; no unauthorized operational writes |
| Freeze and verify candidate | Integration lead / main | Pending confirmation | Before sessions; record exact app/curriculum/environment versions |
| Facilitate and record | Human facilitator and observer | Pending assignment | Dates/timezone pending participant availability and consent |
| Approve privacy and retention | Data owner | Pending assignment | Before collecting results or recordings |
| Review readiness | Process, security and release owners | Pending assignment | After observed results, failures and missing samples are reviewed |

- [ ] Recruit two first-time participants per eleven personas and schedule four mixed-role sessions; record repeat-person sessions separately.
- [ ] Fill named assignments and real dates above; agree consent, accessibility needs and device coverage.
- [ ] Approve exact routine, negative and handoff scenarios using the [pilot protocol](task-first-pilot-protocol.md). Its percentages and timings are targets, not results.
- [ ] Give the facilitator the [blank results CSV](task-first-pilot-results-template.csv). Empty cells mean unobserved, never zero or pass. Keep it blank until an actual consented session.
- [ ] Stop on suspected bypass, disclosure or incorrect handoff; retain assisted, failed, aborted and timed-out cases in denominators.
- [ ] Publish actual sample counts and scoped residuals before a human release decision. Automated/agent capture is not a human pilot.
