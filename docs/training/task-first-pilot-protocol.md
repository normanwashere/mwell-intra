# Task-first Human Pilot Protocol

Status: NOT RUN. Recruitment, session counts, measured scores and participant outcomes are not available. This document defines targets, not results. Task11 follows the approved task-first design and implementation plan; automated tests and agent sessions cannot substitute for participants.

## Entry and Safety

Begin only after the integration lead freezes the candidate, records exact UAT app commit/database/curriculum versions, and approves the required automated gates and documentation. No production work or live captures are authorized by this protocol alone. Use designated synthetic records and explicitly authorized tester roles. Preserve seeds; record any planned mutations and cleanup ownership before each session. Do not waive certification, DOA, evidence or ownership prerequisites to make a task pass.

Obtain consent before recording. Use anonymous participant/session IDs; keep the recruiting identity key outside shared artifacts. Explain that the system, not employee performance, is being evaluated. Participants may stop at any point. Stop any scenario on suspected compliance bypass, unintended disclosure, wrong-party handoff or operational risk and escalate to the security/process owner.

## Recruitment and Devices

Target at least two first-time participants for each of eleven personas (22 participants where staffing permits), plus four mixed-role sessions. Record actual distinct-person and session counts separately, prior app/domain experience and device. Repeated participants are not new first-time evidence. If recruitment falls short, results stay provisional with restricted rollout.

| Persona | Goal scenario for process-owner fixture preparation | Negative / handoff focus | Device |
| --- | --- | --- | --- |
| General Employee | Obtain needed stock or submit a governed request and locate its status | Returned request, missing evidence, identify approver | Both |
| Operations Associate | Receive/inspect a designated delivery or fulfill an assigned order | Wrong/duplicate serial or quantity variance; supervisor escalation | Mobile first |
| Operations Lead | Resolve a prepared quality hold or count variance | Missing operator evidence, separation of duties, reject/correct | Both |
| Procurement Lead | Progress a prepared purchasing case | Missing requirement, supplier/approval handoff | Desktop first |
| Finance Controller | Review a prepared payment-readiness or inventory-close case | Missing receipt/inspection or incompatible evidence; release owner | Desktop first |
| Legal & Compliance Lead | Review a prepared vendor accreditation case | Outdated/missing evidence, correction and correct decision owner | Desktop first |
| Marketing & Events Lead | Prepare an event stock request and reconcile an assigned outcome | Custody discrepancy, return/loss evidence, Finance handoff | Both |
| Product Owner | Review a prepared readiness/pricing proposal | Missing approval evidence, contributor/owner boundary | Desktop first |
| Leadership / Insights | Locate and verify a decision indicator's source | Stale/unavailable source, escalation rather than unsupported write | Desktop first |
| Platform Administrator | Process an authorized access/configuration correction | Wrong scope, audit evidence, escalation | Desktop first |
| Vendor Representative | Complete the vendor's own case requirement | Correction/evidence/signature prerequisite; Legal handoff | Mobile and desktop |

The process owner must supply each exact existing task/feature ID, record fixture, prerequisites, policy version and expected authoritative result before use. This table authorizes no unavailable business function and invents no policy thresholds.

Four mixed-role session targets: Finance across Warehouse/Procurement/Events; Operations plus employee/requester and Product contributor; Procurement plus employee; Legal plus administrative scope. Include cross-device continuation and an approved new/revoked-role recovery scenario. Vendor/internal audiences must not blend; use existing identity policy, never force incompatible assignments for convenience.

## Session Method

1. Record anonymous ID, experience, actual device/viewport, candidate and approved fixture IDs. Verify the assigned scope without coaching navigation.
2. Give a business goal, not labels or click instructions: routine task, correction/negative case, then handoff/escalation. Read-only roles verify source/context instead of performing a write.
3. Start task-finding timing when the goal is shown. Stop at the first correct task/guide. Record the first meaningful action separately; opening a guide is not business completion.
4. Observe unassisted work. Log help requests, wrong destination, error category, time and completion against the approved record-state result. If assistance is necessary, mark assisted and capture the category, not a manufactured unassisted success.
5. Ask the participant to identify the next responsible owner without explaining it. Confirm against the approved workflow. Ask the Single Ease Question (1 very difficult to 7 very easy) after each case.
6. Close the session, confirm fixture disposition/cleanup by its owner and invite voluntary feedback. Preserve failures. After fixes, rerun failed scenarios with fresh participants where possible; report repeated attempts separately.

## Targets, Not Results

- Routine unassisted success at least90% overall; investigate every persona below80%.
- Correct recovery/escalation at least90% on scripted negatives.
- Median correct task/guide location time at most30seconds; include distribution, failures and timeouts rather than dropping them.
- Correct unprompted handoff-owner identification at least80%.
- SEQ median at least6/7, with sample size and persona/device breakdown.
- Any critical compliance bypass or incorrect handoff is blocking irrespective of averages.
- Separately maintained search benchmark: correct executable guide in top3 for at least90% of55queries; zero unauthorized audience disclosure. Do not conflate benchmark runs with human results.

Denominators include assigned scenarios, with aborted/unattempted cases separately visible. Report raw numerator/denominator and missing data; do not silently remove failed searches or assisted cases. No composite score may hide a weak persona.

## Minimal Results Template

The [blank results template](task-first-pilot-results-template.csv) contains column headers only, not participant records. Populate an actual results sheet only after consented sessions. Fields: anonymous participant ID; session ID; persona/scope category; first-time/repeat; experience band; device/viewport; app/curriculum version; approved task/fixture reference; routine/negative/handoff category; first-action time; finding time or timeout; assisted flag; completion classification; authoritative-result checked flag; owner identification correct/incorrect/unobserved; error/help category; SEQ; retest linkage; blocker disposition. All cells are currently unobserved, not zero. Named organizer assignment and real session dates are pending; use the [readiness checklist](task-first-certification-ready.md) to assign who and when before recruitment or scheduling claims.

No names, raw search strings, form values, serials, filenames, tokens, policy answers or customer/vendor payloads in shared telemetry/results. Recording access and retention require consent and data-owner approval. Proposed minimal-event retention90days and cohort suppression below5 are not automatic authorization to collect or publish; use restricted per-persona review for small samples. No productivity ranking.

## Exit Decision

Publish observed per-persona results with targets side by side. Release/process/security owners decide measured readiness or explicitly limited pilot status. Missing participants, untested devices, unresolved failures and unsupported scenarios remain listed. No launch approval or usability score is claimed by this protocol.
