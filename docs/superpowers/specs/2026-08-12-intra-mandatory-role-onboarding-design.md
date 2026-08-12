# Mwell Intra Mandatory Role Onboarding Design

**Date:** 2026-08-12

**Status:** Approved design for implementation planning

**Scope:** Internal onboarding for all current operating personas, external vendor onboarding, capability certification, retraining, emergency exceptions, content governance, and launch certification

## Objective

Replace the current four-step Knowledge Base orientation with a mandatory, role-driven onboarding system that proves a user can perform assigned work before the application permits live mutations.

The experience must teach users inside realistic versions of the actual Mwell Intra modules. It must preserve read-only exploration and help access, isolate all practice activity from operational data, issue server-verified capability certifications, and support new departments, roles, workflows, and policies without redesigning the onboarding platform.

## Approved Product Decisions

1. Onboarding is required before live work. Read-only exploration remains available.
2. Active roles generate the baseline curriculum. Authorized administrators and department owners may add required or optional modules.
3. Completion requires demonstrated competency, not page views.
4. Practice uses interactive simulations with realistic sample data and no operational writes.
5. Retraining is risk-based and reopens only affected requirements and capabilities.
6. Governance is shared:
   - Platform Administrators own platform configuration and technical controls.
   - Department leads own department-specific learning requirements and team completion.
   - Legal owns controlled policy content and acknowledgments.
   - Users see and manage their own assigned learning.
7. Vendor representatives use a separate external onboarding journey.
8. Launch enforcement is immediate for all existing and new users. There is no general grace period.
9. The primary learning pattern is an in-context coached tour inside actual module screens.
10. A compact Onboarding Center provides assignments, deadlines, progress, resume, policy, certification, and support.
11. A Platform Administrator may issue a narrow, time-limited emergency exception. The exception requires a reason, business approver, expiry, warning, and audit evidence. It cannot waive a Legal policy acknowledgment.
12. Content uses a mixed maintenance model:
    - Department and Legal owners edit lessons, policy text, questions, and publication metadata in-app.
    - Engineering owns the simulation runtime, training adapters, and stable screen anchors.
13. Multi-role users unlock live work role by role. Shared actions unlock only after every prerequisite capability is certified.
14. Release certification covers every role, curriculum, journey, workflow branch, enforcement boundary, and supported responsive width.

## Current-State Problem

The current `FirstTimeJourney` is useful orientation content but is not a training control:

- It contains four static explanatory steps.
- A user may jump between steps and mark the journey complete without demonstrating an outcome.
- Progress is stored only in browser `localStorage`.
- It is not bound to active role assignments or capability authority.
- Opening a role guide or practice workflow does not prove completion.
- It does not prevent a user from calling a live mutation directly.
- It does not version completion against policies, workflows, or curriculum changes.
- Administrators and department owners cannot assign, monitor, or govern training.
- It provides no reliable certification, retraining, exception, or audit evidence.

The existing orientation remains useful as source content, but it will not remain the authority for live access.

## Experience Architecture

### Onboarding Center

Add `/onboarding` as the single home for internal training. It contains:

- Current persona, department, and active scoped roles.
- A plain-language explanation of why onboarding is required.
- Required, optional, completed, expired, and retraining assignments.
- Overall progress and progress by certified capability group.
- Estimated time and due date for each activity.
- Resume action for the next incomplete requirement.
- Policy acknowledgment status.
- Active certifications and the live actions they enable.
- Locked capabilities with a direct link to the missing requirement.
- Emergency exception warning, scope, approver, and expiry when applicable.
- Support and recovery actions.

The center is deliberately compact. It coordinates learning but does not replace the in-context experience.

### In-Context Coached Tour

Selecting a simulation opens the actual target module in training mode. Training mode must:

- Use the same responsive layout and control placement as live work.
- Clearly and persistently identify itself as `Simulation`.
- Explain the current objective in plain language.
- Highlight one relevant control or decision area at a time.
- Keep the target visible without covering it.
- Move keyboard focus to the coach or target predictably.
- Provide Back, Exit, Help, and Resume Later controls.
- Include happy-path, validation, exception, and recovery branches.
- Explain why an incorrect decision is unsafe before allowing a retry.
- Preserve progress across refresh, navigation, device change, and session renewal.
- Never call an operational mutation endpoint.

Desktop uses an anchored coach adjacent to the target when space permits. Mobile uses a bottom coach sheet that can collapse to reveal the full target. Both patterns must retain a visible simulation banner and progress indicator.

### Locked Live Action

When a user attempts a live mutation without a current certification, the application must not show a generic dead end. It must:

1. Deny the command before any operational write.
2. Name the capability that is locked.
3. Explain the missing or expired training requirement.
4. Offer `Start training` or `Resume training`.
5. Offer a safe return to the source workspace.
6. Show emergency-exception guidance only to eligible internal users.
7. Record a denied attempt without storing sensitive form content.

The denial must remain effective for direct URLs, forged client state, stale browser sessions, and direct API or RPC calls.

## Curriculum Model

### Requirement Types

A curriculum version may include these requirement types:

- `orientation`: role purpose, responsibilities, limits, handoffs, and escalation.
- `policy`: controlled document acknowledgment with version and effective date.
- `tour`: in-context interaction sequence using a training adapter.
- `scenario`: decision tree with happy, negative, and exception outcomes.
- `assessment`: scored questions selected from a versioned pool.
- `attestation`: an explicit user declaration where policy requires it.

Each mandatory requirement defines prerequisites, pass criteria, retry rules, estimated duration, capability outcomes, and material-change behavior.

### Curriculum Resolution

The resolver builds a user's effective curriculum from:

1. Active scoped roles.
2. Role-to-curriculum mappings.
3. Department-required assignments.
4. User-specific required or optional assignments.
5. Effective policy requirements.
6. Existing active certifications.
7. Retraining triggers.

Duplicate requirements are collapsed by immutable requirement version. Completing a shared requirement once satisfies every compatible curriculum that references the same version.

Removing a role stops future role-based requirements and revokes certifications that depend only on that role. It does not delete historical assignments, attempts, acknowledgments, or certificates.

### Multi-Role Unlock

Capability authority is evaluated independently:

`effective live capability = active role capability AND active capability certification`

For a user with Finance and Operations roles:

- Completing Finance training enables certified Finance mutations.
- Incomplete Operations training keeps Operations mutations locked.
- A cross-department command requiring both certified capability sets stays locked until both are active.
- Read-only access continues to follow the existing role and RLS model and does not require mutation certification unless a specific controlled policy says otherwise.

Onboarding never grants a role or broadens data scope. A certification can only activate a mutation capability already granted by current role authority.

## Persona Curricula

The platform must derive curricula from the canonical persona and capability catalogs. The initial release includes these baseline outcomes.

| Persona | Required competency areas |
| --- | --- |
| Platform Administrator | Identity lifecycle, scoped role assignment, department governance, DOA administration, audit review, safe recovery, emergency exceptions, and segregation boundaries |
| General Employee | Persona and access context, My Work, purchase and stock requests, event demand, evidence, status tracking, handoffs, and access recovery |
| Operations Associate | Receiving, delivery date and batch traceability, serialization, putaway, stock movement, event issue/return custody, returns intake, quarantine, and cycle counting |
| Operations Lead | Warehouse/location/bin setup, operation routes, quality release, stock and count approvals, exceptions, inventory integrity, replenishment, and two-person operating controls |
| Procurement Lead | Request intake, policy and DOA routing, sourcing, vendor eligibility, award evidence, purchase order authoring, receiving handoff, and procurement exceptions |
| Finance Controller | Budget and approval controls, procurement and warehouse finance, three-way match, payment readiness, valuation, COGS, expense, write-off, event settlement, close, and reconciliation |
| Legal & Compliance Lead | Vendor invitation, accreditation requirements, document and instrument review, risk and declarations, DOA governance, decision authority, renewal, suspension, and offboarding |
| Marketing & Events Lead | Event planning, demand, approval, allocation handoff, custody visibility, sales/giveaway outcomes, returns, loss/damage, re-kitting, and reconciliation |
| Product Owner | Product governance, readiness evidence, pricing decisions, launch authority, handoffs, exceptions, and decision audit |
| Leadership / Insights | Read-only decision support, metric provenance, privacy boundaries, governed exports, interpretation limits, and escalation of data quality concerns |
| Vendor Representative | External account setup, accreditation requirements, evidence upload, declarations, signatures, corrections, expiry, submission, status, and support |

The baseline table describes outcomes, not hard-coded lesson lists. Published curricula reference versioned Knowledge Base content, simulations, scenarios, and assessments.

## Vendor Onboarding Boundary

Vendor onboarding is external-facing and must not expose internal role names, internal curriculum metadata, decision rubrics, employee identities, screen anchors, or operational routes.

The vendor journey is:

1. Accept a valid, unexpired, single-use invitation.
2. Establish or recover the external account.
3. Review the accreditation process and privacy terms.
4. Learn evidence, declaration, signature, correction, and expiry requirements.
5. Complete vendor-only coached examples.
6. Acknowledge required external policies.
7. Complete the real accreditation application and submit evidence.
8. Track requests, corrections, and final status.

The real accreditation application is part of vendor onboarding and therefore remains available before final accreditation completion. Vendor capability gating applies to unsafe or premature transitions, such as final submission before required acknowledgments, not to the evidence actions needed to complete onboarding.

Vendor certifications and internal employee certifications use separate curriculum audiences and RLS policies.

## Completion and Certification

### Completion Rules

A curriculum is complete only when:

- Every mandatory prerequisite is complete.
- Every mandatory tour has reached its required terminal outcomes.
- Required scenarios include both the primary and designated exception branches.
- Assessments meet the published passing score.
- Required policies and attestations are acknowledged at their effective version.
- There is no unresolved integrity flag on the attempt.

Opening content, advancing a slide, or waiting for a timer is never sufficient.

### Assessment Behavior

- Questions are served from a versioned server-side pool.
- Answer keys are not sent before submission.
- A failed attempt explains the relevant concept without exposing the full pool.
- Retry timing and maximum attempts are configurable per assessment.
- Exhausted attempts create a recoverable `Needs support` state and notify the assigned training owner.
- A passed assessment remains bound to its curriculum and question-pool versions.

### Certification

The server issues capability certifications after evaluating the complete requirement graph. A certification contains:

- User and department scope.
- Source role assignment.
- Certified capability.
- Curriculum and requirement versions.
- Issued, effective, expiry, revoked, and superseded timestamps.
- Completion evidence references.
- Issuing service and applicable policy version.

Certification issuance must be idempotent. Replaying the same completion event cannot create duplicate active certifications.

## Retraining

Retraining is triggered by:

- A new role or newly scoped capability.
- A materially changed workflow or simulation.
- A materially changed policy.
- Certification expiry.
- A changed department requirement.
- Corrective training assigned by an authorized owner.
- Revocation after a controlled incident or access review.

Publishers must classify changes as material or non-material. Material changes identify affected requirements and capability certifications. Non-material copy, spelling, and visual-only changes preserve certification.

When retraining becomes effective:

- Only affected mutation capabilities relock.
- Unaffected certified capabilities remain available.
- The user receives an in-app notification naming the reason and deadline/effective time.
- If a policy requires immediate suspension, relocking is immediate.
- Historical evidence remains immutable.

## Emergency Exception

An emergency exception may be created only by an authorized Platform Administrator. It requires:

- User and exact capability scope.
- Business reason and incident/reference identifier.
- Named business approver.
- Start and expiry time.
- Maximum duration enforced by configuration.
- Confirmation that no Legal acknowledgment is being waived.
- Visible warning to the user and relevant control owners.

An exception does not create a certification. The enforcement service treats it as a separate temporary authority source. It expires automatically, can be revoked early, cannot be renewed silently, and is recorded in the immutable audit trail.

An administrator may not issue an exception to themselves without a distinct approver.

## Content Governance

### In-App Ownership

Authorized department and Legal owners may:

- Create and edit lesson content.
- Reference approved Knowledge Base guides.
- Create and maintain question pools.
- Attach controlled policies.
- Define pass scores, retry rules, duration estimates, and due rules.
- Preview a curriculum as a selected persona.
- Submit a version for review.
- Publish, schedule, supersede, or retire an approved version.

Publishing requires owner, reviewer, change reason, source references, effective date, materiality classification, and affected capability mapping.

### Engineering Ownership

Engineering owns:

- Simulation definitions and training adapters.
- Stable `data-onboarding-anchor` identifiers.
- Allowed training actions and expected outcomes.
- Operational-command isolation.
- Responsive coach-placement behavior.
- Automated anchor and branch contracts.

A curriculum version cannot publish when it references a missing, ambiguous, hidden, inaccessible, or incompatible required anchor.

## Technical Components

### Shell Components

- `OnboardingGate`: resolves read-only, certified, locked, and emergency-exception states.
- `OnboardingCenter`: renders assignments, progress, certification, and recovery.
- `LockedCapabilityRecovery`: replaces generic denial for uncertified mutations.
- `TrainingModeProvider`: provides immutable simulation context to participating modules.
- `CoachOverlay`: positions instructions, focus, progress, and actions.
- `TrainingBanner`: persistently identifies simulation mode.
- `PolicyAcknowledgment`: renders the controlled version and records explicit acceptance.
- `AssessmentRunner`: serves, submits, explains, and retries scored checks.

### Domain Integration

Each participating module exposes a training adapter with a narrow contract:

- Load deterministic scenario state.
- Resolve stable anchors.
- Accept only declared simulated commands.
- Validate the expected state transition.
- Report checkpoints to the onboarding service.
- Reset or resume simulation state.

Training adapters must not import or call operational mutation repositories. CI enforces this boundary with dependency and runtime contracts.

### Server Services

- Curriculum resolution.
- Assignment and requirement progress.
- Assessment scoring.
- Simulation checkpoint validation.
- Policy acknowledgment.
- Capability certification.
- Retraining impact evaluation.
- Emergency exception management.
- Completion and authority audit.

## Data Model

Use a dedicated `learning` schema so training data does not become coupled to Knowledge Base preferences or operational tables.

### Content and Versioning

- `learning.curricula`
  - Stable curriculum identity, audience, owner department, and lifecycle.
- `learning.curriculum_versions`
  - Version, status, effective dates, change reason, materiality, owner, and reviewer.
- `learning.requirements`
  - Stable requirement identity and type.
- `learning.requirement_versions`
  - Content references, simulation ID, assessment settings, pass rules, and audience.
- `learning.curriculum_requirements`
  - Requirement graph, order, mandatory flag, prerequisites, and capability outcomes.
- `learning.role_curricula`
  - Role and scope mapping to effective curriculum versions.

### Assignment and Evidence

- `learning.assignments`
  - User, source, curriculum version, status, due date, assigned/reassigned timestamps, and retraining reason.
- `learning.assignment_requirements`
  - Requirement status, attempt count, progress, started/completed timestamps, and last checkpoint.
- `learning.attempts`
  - Requirement attempt, mode, status, score, integrity result, and timing.
- `learning.attempt_events`
  - Append-only checkpoints, decisions, validation outcomes, and recovery events.
- `learning.policy_acknowledgments`
  - User, controlled document/version, accepted timestamp, and evidence hash.
- `learning.certifications`
  - Capability, assignment/role scope, version evidence, status, and lifecycle timestamps.
- `learning.emergency_exceptions`
  - Capability scope, reason, reference, grantor, approver, effective window, revocation, and audit metadata.

Knowledge Base saved items, recent views, and feedback may remain preferences. Onboarding authority and evidence must never be stored only in browser storage.

### RLS and Access

- Users may read their own assignments, attempts, acknowledgments, certifications, and exceptions.
- Department owners may read completion for users and curricula inside authorized department scope.
- Legal may govern and review controlled policy acknowledgments within policy scope.
- Platform Administrators may manage technical configuration and approved exceptions.
- Content authors cannot alter completion evidence.
- Learners cannot write scores, certifications, requirement completion, or exception authority directly.
- Vendor policies cannot enumerate internal learning records.

All authoritative transitions occur through guarded RPCs or server services with attributable audit events.

## State Models

### Assignment

`assigned -> in_progress -> completed`

Additional states: `blocked`, `expired`, `superseded`, `cancelled`.

- `blocked` requires a visible cause and recovery action.
- `superseded` points to the replacement assignment.
- Completion cannot be reversed by editing content; material change creates retraining.

### Requirement

`not_started -> in_progress -> passed`

Alternative states: `failed_retryable`, `needs_support`, `expired`, `waived`.

`waived` is permitted only for explicitly waivable internal requirements and requires authorized evidence. Legal policy acknowledgment is never waivable.

### Certification

`active -> expired | revoked | superseded`

Only `active` certifications satisfy the capability gate.

### Content

`draft -> in_review -> approved -> scheduled | published -> superseded | retired`

Published content is immutable. Changes create a new version.

## Failure and Recovery

### Network or Supabase Failure

- Never infer completion from client state.
- Preserve local non-authoritative progress only as a resume hint.
- Show whether a checkpoint is saved or pending.
- Retry idempotently with the same attempt and checkpoint identifier.
- Keep live mutations locked until authoritative readback succeeds.

### Session Expiry

- Preserve the onboarding return route and current checkpoint.
- Reauthenticate, reload server progress, and resume from the last accepted checkpoint.
- Do not replay a simulated or live command automatically.

### Missing or Moved Anchor

- Stop the tour with `Training needs an update`.
- Do not guess a replacement control.
- Preserve progress and provide a return to the Onboarding Center.
- Alert the curriculum and engineering owners.
- Block publication in pre-release environments when an anchor contract fails.

### Role Change During Training

- Re-resolve the curriculum after the authoritative role change.
- Preserve still-applicable completed requirements.
- Cancel requirements that no longer apply without deleting evidence.
- Add new requirements and keep new capabilities locked.
- Revoke certifications that have lost their source role authority.

### Concurrent Devices

- Server progress is authoritative.
- Checkpoints and completion are idempotent.
- A stale device reloads the latest accepted state before continuing.
- Conflicting active assessment attempts follow the assessment's concurrency rule and never merge answers silently.

## Security and Privacy

- Simulation mode uses dedicated training adapters and scenario state, not a marker inside operational records.
- No simulation may write to inventory, procurement, vendor, event, finance, Legal decision, access, or audit tables intended for business transactions.
- Capability enforcement exists at UI, API/RPC, and database policy boundaries.
- Direct requests cannot turn training completion into role authority.
- Assessment answer keys remain server-side.
- Training events avoid raw passwords, confidential document bodies, payment details, and sensitive form content.
- Vendor content, identifiers, APIs, and RLS are isolated from internal curricula.
- Emergency exceptions are separately queryable, expiring, revocable, and audited.
- Content rendering follows existing sanitization and controlled-document rules.

## Accessibility and Responsive Requirements

- Every required journey is keyboard operable.
- Coach focus enters predictably and returns to the invoking control on exit.
- Screen readers announce simulation mode, step changes, errors, progress, and completion.
- Coach UI never relies on color alone.
- Touch targets meet the application's 44 by 44 pixel interaction floor.
- At 200 percent zoom and supported mobile widths, the target, explanation, and actions remain reachable without incoherent overlap.
- Reduced-motion preferences disable nonessential coach movement.
- Long names, multiple role labels, and long policy titles wrap without clipping.
- Users can pause, obtain help, and exit without losing accepted progress.

## Immediate Launch Enforcement

Immediate enforcement applies to all existing and new users when the feature is activated.

To avoid an administrative bootstrap failure:

1. Publish all mandatory baseline curricula.
2. Complete pre-launch certification for at least two designated Platform Administrators through the same controlled assessment process.
3. Verify emergency exception and revocation paths.
4. Generate assignments for all active users.
5. Run a dry resolution report showing who will be locked and why.
6. Obtain department, Legal, Product, Security, and QA approval.
7. Enable the server-side capability gate.

There is no silent grandfathering. Existing users without current certification become read-only for affected live actions at activation.

## Testing and Certification Strategy

### Catalog-Driven Coverage

Tests are generated from the canonical persona, role, capability, curriculum, requirement, simulation, anchor, and workflow catalogs. CI fails when a new mutation capability, required curriculum, persona, or simulation branch has no mapped test coverage.

Initial coverage includes all 11 canonical personas and all current cross-role workflow decision trees. Multi-role tests include compatible role combinations and shared prerequisite capabilities without attempting every mathematically possible combination.

### Required Test Dimensions

Every applicable persona and journey covers:

- First assignment and immediate mutation denial.
- Correct curriculum resolution.
- Department and user-specific additions.
- Shared-requirement deduplication.
- Every tour checkpoint and declared branch.
- Happy path, invalid input, wrong decision, exception, recovery, and retry.
- Assessment pass, failure, exhausted attempts, and support recovery.
- Policy acknowledgment and non-waivable behavior.
- Role-by-role positive unlock.
- Continued denial for incomplete roles.
- Shared prerequisite denial and later unlock.
- Certification expiry, revocation, supersession, and risk-based retraining.
- Role addition, removal, and scope change during training.
- Emergency exception creation, approval, use, expiry, revocation, and self-grant denial.
- Refresh, back/forward navigation, session expiry, offline interruption, and resume.
- Concurrent devices and duplicate checkpoint submissions.
- Direct URL, forged client state, API/RPC, and database bypass attempts.
- Zero operational rows created by simulations.
- Accurate activity and audit evidence.
- Vendor inability to discover internal content or identifiers.

### Responsive and Human Review

Automated and human visual testing covers:

- Desktop: 1440 and 1280 pixels.
- Tablet: 768 pixels.
- Mobile: 390, 360, and 320 pixels.
- Keyboard-only journeys.
- Screen reader checkpoints.
- 200 percent zoom.
- Reduced motion.
- Long content, long names, and multi-role labels.
- Coach target visibility, focus, placement, scroll, and recovery.
- No overlap, clipping, horizontal overflow, obscured warning, unreachable action, ambiguous state, or dead end.
- Comprehension review by users unfamiliar with the workflow.

### Persona-Specific Certification

Each persona receives its own script and evidence set. Each script covers applicable live functions, denied boundaries, cross-role handoffs, and onboarding-specific requirements. Vendor testing runs in a separate external context.

### Three Certification Cycles

1. **Baseline:** all personas, curricula, flows, branches, widths, authority boundaries, and visual evidence.
2. **Clean replay:** fresh users and scenarios prove deterministic resolution, idempotent completion, and complete cleanup.
3. **Recovery:** interruptions, retraining, role changes, emergency exceptions, expiry, and concurrent-device behavior.

### Data Proof

For every state-changing onboarding action, certification requires:

- UI outcome.
- Fresh-session readback.
- Canonical server/database readback.
- Attributable audit evidence.
- Exact source and result identifiers.
- Cleanup or retained-evidence justification.

For every simulation, compare protected operational tables before and after. Any unexpected business row or ledger movement is a P0 failure.

### Release Gates

Release is blocked by:

- Any unauthorized live mutation.
- Any simulation write to operational data.
- Any missing mandatory curriculum for an active mutation capability.
- Any incorrect role-by-role or shared-prerequisite unlock.
- Any vendor/internal data leak.
- Any broken required tour anchor or unrecoverable journey.
- Any inaccessible critical path.
- Any unresolved P0 or P1 defect.
- Incomplete independent cleanup or evidence reconciliation.
- Missing department, Legal, Product, Security, or QA sign-off.

Automated success alone does not authorize launch.

## Observability

Track without storing sensitive answers or business payloads:

- Assignment resolution success and latency.
- Requirement start, completion, failure, retry, and abandonment.
- Tour anchor failures and training-adapter errors.
- Assessment scoring and support escalation.
- Certification issuance, revocation, expiry, and retraining.
- Locked mutation attempts by capability.
- Emergency exception creation and use.
- Resume and cross-device conflicts.
- Vendor boundary denials.

Operational dashboards must distinguish content defects, simulation defects, learner outcomes, and authority failures.

## Knowledge Base Integration

The Knowledge Base remains the source of durable explanation and recovery guidance. Onboarding references versioned Knowledge Base content but adds assignment, practice, assessment, and certification.

After implementation:

- Replace the static `Your first 10 minutes` panel with a personalized onboarding status entry.
- Add role-guide links to assigned curricula and active certifications.
- Add workflow-guide links to applicable simulations.
- Mark screenshots and procedures with the release version used by each curriculum.
- Document locked-action recovery, retraining, emergency exceptions, and vendor onboarding.
- Keep completed training available as reusable guidance without reopening certification unless a material change requires it.

## Out of Scope for the Initial Release

- A general-purpose learning management system for non-Intra training.
- Video authoring or SCORM import.
- Public course catalogs.
- AI-generated assessments or automatic policy materiality decisions.
- Training records inside operational business tables.
- Full no-code editing of simulation logic or screen anchors.
- Silent waivers, permanent exceptions, or automatic grandfathering.

## Acceptance Criteria

The design is implemented successfully when:

1. Every active mutation capability maps to at least one effective role curriculum and certification rule.
2. All current internal personas and the external vendor persona receive correct curricula.
3. Multi-role users receive a deduplicated curriculum and role-by-role unlock.
4. In-context tours use actual responsive screens and cannot call operational mutation paths.
5. Completion, acknowledgment, assessment, certification, retraining, and exception authority are server-side and auditable.
6. Uncertified direct UI, API/RPC, and database mutations are denied without partial writes.
7. Certified users can perform only the live actions already permitted by active role scope.
8. Material changes relock only affected capabilities and preserve historical evidence.
9. Vendor onboarding exposes no internal curricula, roles, identifiers, or data.
10. All three certification cycles pass across all required personas, journeys, branches, and responsive widths with zero unresolved P0/P1 defects.
