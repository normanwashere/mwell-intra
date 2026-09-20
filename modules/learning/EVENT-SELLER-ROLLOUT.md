# Event Seller Learning Rollout

Status: **candidate, pending deployment and governed catalog publication**.
This checkout registers a runtime, not live training, user access, or certification.
Do not treat local memory-mode completion as live evidence. No rollout step below
has been executed by this change.

## Sep20 Staged UAT Preparation

The user authorized explicitly automated independent review and the existing UAT
audit-custodian pair. These profiles are database audit custodians only, **not
human reviewers**: owner `5f86c147-34aa-4722-be5b-ed085caf97eb` (UAT Platform
Administrator), reviewer `ab803856-0f20-4d1a-abe6-8444052725f2` (UAT Legal Compliance
Lead). Both must remain active employees; the owner must retain an effective active
`core.platform_admin` assignment. The platform-governed catalog RLS path requires
an active internal employee with `core.manage_rbac`; privileged execution does not
replace the explicit authorization or independent evidence. The user-approved
nonhuman provenance pattern records actual author/reviewer agent IDs, source and
artifact hashes, authorization reference, and `human_review_claimed=false`.
No AI profile or human approval event is fabricated.

Read-only observation, **2026-09-20 08:08:20 UTC**, exact approved project
`kkoitlvydytdhlpxhuah`: seller requirement/curriculum roots, versions, members,
edges, outcomes, and mappings were all absent. The complete seller-state digest
was `6867a98e1c5f908f990a6066a1f74204`. The private readiness helper was still
absent. This is historical inspection evidence, **not authorization to reuse the
digest without a fresh read immediately before execution**.

The pinned published orientation is version
`2ebc69a8-05fc-452c-ab0d-371c320cdefe`, root/version digest
`b881e643dd9fda267b2be683d483e4d7`. It is reused unchanged. The exact proposed
eight-row draft and content/rules hashes live in
`scripts/sep20-seller-learning-manifest.mjs`; its exported JSON SHA256 is
`ca72812fdf0f8afd6ebeff738fa2b6a500978b776f77eb25af229896c118ab35`.
The manifest's base revision is provenance, not deployed-build evidence. Parent
subsequently recorded runtime source revision
`998906fee743dfc9baaa895c5d713d152a488de2`; the content/rules hashes must still match.

**Hold:** the Sep20 live preflight found inherited broad warehouse SELECT access
for the proposed seller. Parent owns rollout, and Confucius owns the RLS repair.
Do not provision sellers, publish learning, or enable an event until independent
role-isolation proof and deployed runtime parity are retained. Preparation and
read-only inspection are allowed. The learning helper does not resolve that RLS
blocker or infer its success.

### Executable Preparation

Use Node 24 from the full onboarding checkout:

```powershell
node scripts/sep20-seller-learning.mjs manifest
node scripts/sep20-seller-learning.mjs preflight
node --test scripts/sep20-seller-learning.test.mjs
node scripts/sep20-seller-learning.mjs render <stage-input.json>
```

The tool is a **SQL renderer only**, with no database client, credentials, automatic
execution, migration, role grant, role mapping, or learner-evidence writes.
`preflight` prints a read-only transaction; execute it only against the bound UAT
project and inspect the full root/graph plus fingerprint. Every mutation render
defaults to `rollback`. Do not manually replace rollback with commit.

Each stage input contains `operation` and the freshly observed
`baselineFingerprint`. Approval/publication also require `reviewArtifactPath` and
the actual file-byte `reviewArtifactSha256`. For an apply render, add `mode=apply`,
`executionApprovalPath`, and its actual file-byte `executionApprovalSha256`.
Each of these six operations must be separately inspected and authorized:

| Operation | Required State | Result |
| --- | --- | --- |
| `draft` | No seller roots or mappings | Eight proposed rows; two draft versions, no approval/effective timestamps |
| `submit-review` | Both versions draft | Both in review, still no approval |
| `approve-requirement` | Both in review | Requirement approved with actual AI evidence |
| `publish-requirement` | Requirement approved, curriculum in review | Requirement published, honest current publication/effective time |
| `approve-curriculum` | Requirement published, curriculum in review | Curriculum approved after graph validation |
| `publish-curriculum` | Requirement published, curriculum approved | Curriculum published, still no role mapping |

The independent review JSON contract is `schemaVersion:1`, `reviewMode:automated`,
`humanReviewClaimed:false`, `verdict:approved`,
`scope:seller_learning_content_and_inactive_publication`, exact `projectRef`,
`authorAgentId`, `reviewerAgentId`, `manifestSha256`, `contentSha256`, `rulesSha256`,
actual `reviewedAt`, exact manifest `userAuthorizationReference`, a `findings`
array, and `activationApproved:false`. Confucius must produce the actual review;
an example or fixture is not evidence. A rejected review cannot advance approval.

Actual independent AI content/publication review is recorded in
`docs/audits/2026-09-20-SELLER-LEARNING-INDEPENDENT-REVIEW.json`, file SHA256
`83f688571dac0953071011e04e4e0d2b391f0b76423c5584ca315025f792e041`.
It approves the exact content and inactive publication only. It is not activation,
account provisioning, learner completion, or event enablement approval.

The separate parent execution JSON contract is `schemaVersion:1`,
`executionApproved:true`, exact `projectRef`, `manifestSha256`, `operation`,
`baselineFingerprint`, SHA256 of the **exact rollback SQL** as
`rehearsalSqlSha256`, the supplied `reviewArtifactSha256` (or null when absent),
`authorizedByAgentId:01a0b4fc-57b0-7351-84ee-b8baeb3a422c`, actual `authorizedAt`,
and exact `userAuthorizationReference`. Publishing additionally requires
`roleIsolationVerified:true`, an actual `roleIsolationEvidence` reference, and
an actual `runtimeEvidence` reference. These attestations must follow the real
proof; setting booleans is not a substitute. Retain both artifact files and their
hashes with stage output. An uncertain response requires readback, not replay.

Only parent executes each authorized stage. Re-read after each stage; a changed
graph, content, custodian, source hash, or existing mapping stops the helper. If a
stage committed despite response loss, inspect the expected IDs/statuses and
continue only with a new stage-specific approval. No all-stage command exists.
The renderer holds no authenticated-user impersonation settings and never
disables RLS/triggers. Live access/RLS enforcement is not proven by local PGlite.

### Separate Role Mapping

After both versions are published and the isolation/runtime hold is cleared:

```powershell
node scripts/sep20-seller-learning-activate.mjs render <activation-input.json>
```

Use `operation:activate-role-mapping`, fresh full-state `baselineFingerprint`, and
the same actual content review path/hash to verify persisted provenance. That
review **does not authorize activation**. Apply requires a new parent execution
artifact using the contract above, with this activation operation and exact
rollback SQL hash, plus actual isolation/runtime evidence. The only authorized
activation actor is parent `01a0b4fc-57b0-7351-84ee-b8baeb3a422c`, not the content
reviewer. Default remains rollback.

The helper inserts only mapping `575ba1a0-5aed-4619-8ef7-5dfcee5b42d7`, global
`events/seller`, internal audience, curriculum version
`dc01d869-aecc-4f27-a326-953b33b2a0b7`, null department/expiry, and current
transaction effective time. Exact graph/provenance, active narrow two-capability
role, owner custody, orientation digest, and absence of competing mappings are
checked. `private.event_seller_learning_ready()` must return true after insertion
or the entire mapping transaction fails. No users, memberships, assignments,
progress, attempts, or certificates are inserted.

Publish and map **before** provisioning the synthetic seller. Read-only/live
rehearsal found that before a role has a published mapping,
`learning.is_certification_required` is false and the raw role can yield an
effective `record_event_outcome` capability; the disabled event-readiness gate and
missing event assignment still prevent operational posting. Do not describe an
unmapped role as already certification-blocked. The runner's initial mutation
denial assertion is deliberately after published assignment/mapping exists.

### Synthetic Marketing Persona

The approved test persona has exactly `events.seller`, no `core.staff`, an active
internal `employee` profile labelled synthetic, and one genuine Marketing
`member` scope effective `2026-09-20` with no expiry. Live read-only verification
confirmed department `marketing`, name Marketing, active, UUID
`7e55e54e-86cd-4157-9fdb-7616be83e340`. Recheck this identity before provisioning.
Do not add owner/primary scope, invent a department, or add certification exceptions.

Live resolver/certification logic requires an effective department membership;
there is no `core.profiles.department` field. This legitimate membership uses the
existing pathway unchanged. `core.has_cap` derives capabilities from effective
roles, not department membership. `private.learning_owns_department` requires
`scope_type=owner`, so this member scope grants neither others' learning access nor
catalog management. Live Marketing-specific role mappings were absent; the role
join prevents membership alone from assigning requester/coordinator/admin courses.
Procurement request reads use explicit requester/collaborator or governed
capabilities, not Marketing membership. Authenticated reference-table reads exist
independently of membership. These source/live-definition checks are not an RLS
session test; retain Confucius's same-persona Marketing-member isolation proof.

### UI Learning Runner

The self-contained runner has no imports from dirty/untracked WMS QA helpers:

```powershell
node scripts/sep20-seller-learning-live.mjs inspect
node --test scripts/sep20-seller-learning.test.mjs scripts/sep20-seller-learning-live.test.mjs
node scripts/sep20-seller-learning-live.mjs run
```

Run is held until parent supplies actual provisioning, deployment, isolation and
published mapping evidence. Required environment: ephemeral `AUDIT_PASSWORD`,
`AUDIT_LEARNING_GO=MAIN_GO_AFTER_SELLER_ISOLATION_AND_PUBLICATION`,
`AUDIT_MUTATIONS=learning-only`, `SELLER_LEARNING_APPROVAL_PATH`, and exact raw-file
`SELLER_LEARNING_APPROVAL_SHA256`. Never store or print the password/session.

The parent approval JSON has `schemaVersion:1`, `authorizedByAgentId` equal to the
parent ID above, exact `projectRef`, `origin:https://mwell-intra-uat.vercel.app`,
actual `expectedCommit`, actual provisioned `actorId`, exact email
`intra.seller.uat.sep20@mwell.com.ph`, `synthetic:true`,
`roles:{"events":["seller"]}`, the Marketing `departmentId` above, fresh `runId`,
actual `provisionRunId`/`provisionSha256`, current inspect output `sourceSha256`,
the manifest SHA above, actual `roleIsolationEvidence` and
`learningPublicationEvidence` references, actual `authorizedAt`, and `expiresAt`
no more than 24 hours later. Re-inspect in the release checkout: raw source hashes
are checkout-specific, including line endings. Example/fixture artifacts are not
execution authority.

The runner signs in through normal UI, verifies own Auth/profile/role/Marketing
membership, and requires a fresh learner with no previous attempt/certificate.
Only UI-triggered assignment resolution/evaluation and exact armed learning
commands are allowed; all operational mutations are blocked. It completes the
orientation and six visible reviewed choices, then reads normal own snapshot and
checkpoint evidence. It verifies exactly one own effective seller certificate
with both required learning items and the original role assignment. It never
seeds SQL evidence or directly calls learning completion RPCs. On uncertainty it
stops, retains evidence/readback, and never automatically retries or resets.

Screenshots are captured at 1440x900 and 390x844 throughout the same attempt and
after reload. Mobile is responsive continuation, not another completion. Output
is a new OS-temp `sep20-seller-learning-*` directory containing report, command
intents and screenshots. Browser context is closed; no storage state, trace, or
credential artifact is retained. Context closure does not revoke the Auth session.
Local script tests are not live completion, visual inspection, or human pilot proof.

## Approved Scope

Each confirmed seller uses a named individual account, the narrow `events.seller`
role, and an active assignment to a specific event with an explicit validity window.
The role reads event custody through `view_event_custody`; its only mutation is
`record_event_outcome`, which remains `certification_required`. Neither orientation
nor registration of this catalog grants authority. Event gate/assignment management
remains with the appropriately certified `manage_events` owner, and settlement
approval remains with independent Finance. Buyer, inspector, and existing event
owner qualifications are unchanged.

## Publication Manifest

The Learning governance owner must review these exact source definitions with the
Events control owner and an independent reviewer before activation:

| Field                                 | Value                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Requirement key                       | `internal.role.events.seller.custody-practice.v1`                         |
| Requirement version / audience / kind | `1` / `internal` / `scenario`                                             |
| Title                                 | Record your event sales and giveaways                                     |
| Simulation ID                         | `event-seller-custody-v1`                                                 |
| Curriculum key / version              | `internal.role.events.seller.v1` / `1`                                    |
| Persona presentation                  | General employee (does not grant an action role)                          |
| Requirement order                     | Existing `internal.general_employee.orientation.v1`, then seller practice |
| Mandatory                             | Both requirements                                                         |
| Prerequisite                          | Seller practice requires that orientation version                         |
| Only capability outcome               | Seller practice: `events.record_event_outcome`                            |
| Maximum attempts / waivable           | `3` / `false`                                                             |
| Assessment settings / passing score   | `{}` / `null` (checkpoint-backed scenario)                                |
| Role mapping                          | Only module `events`, role `seller`, audience `internal`                  |

Exact scenario `pass_rules`:

```json
{
  "required_checkpoints": [
    "verify-assignment",
    "verify-custody",
    "record-outcome",
    "retry-intent",
    "reverse-correction",
    "handoff-finance"
  ]
}
```

Public instructions/choices: `src/eventSellerTraining.ts`. Server-only evaluation:
`src/eventSellerTrainingAuthority.server.ts`. Preserve all six checkpoints; do not
substitute a generic event-owner simulation or put answer keys in public metadata.
Record the reviewed source revision/hash and this runbook in `source_references`.
The governance owner records the accountable governance-owner key, estimated
minutes, change reason, and named owner UUID in the approval packet; those values
must match the persisted draft and may not be fabricated from a demo identity.

## Draft, Review, Publish, Activate

These are separate authorized change-control steps, not an instruction to advance
every status in one script. Existing publisher implementations document the table
contracts (`scripts/publish-warehouse-operator-receiving-certification.mjs`); do not
run them for sellers or copy their automatic state advancement.

1. Rehearse against an isolated database and approved build first. Confirm the
   Events seller migration, RBAC classification, simulation runtime, and server
   choice authority are present in the same candidate. Verify the six decisions
   and denial cases with named test accounts. Obtain release authorization before
   touching the target environment.
2. The authorized catalog owner creates the seller root in `learning.requirements`
   (`requirement_key` above, `audience=internal`, `requirement_kind=scenario`,
   `status=active`, accountable `governance_owner`, `created_by`). Create version 1
   in `learning.requirement_versions` with **status `draft`**, the manifest fields,
   `materiality=material`, and the approved source reference and `owner_id`.
   Verify any existing matching key/version for exact equality; a conflict stops
   publication rather than overwriting content.
3. Reuse the existing published, effective, internal general-employee orientation
   requirement version with no capability outcome. If unavailable, its owner must
   publish that prerequisite through its existing governance path first; do not
   waive, clone, silently omit, or change it to unblock sellers.
4. Create `learning.curricula` with the seller catalog key and internal audience,
   then `learning.curriculum_versions` version 1 in **`draft`**, recording owner,
   reason, materiality, and source references. In `curriculum_requirements`, add
   only the two pinned versions in manifest order (`sort_order` 1 and 2, both
   mandatory). In `curriculum_requirement_prerequisites`, link the seller member
   to the orientation version. In `curriculum_capability_outcomes`, link only the
   seller member to `events.record_event_outcome`. Child rows use the matching
   curriculum/member/requirement UUIDs and internal audience.
5. Submit each draft to **`in_review`**. An independent actual reviewer verifies
   content, all six pass rules, graph, scope, retry/reversal controls, and source
   revision. Record the review evidence in change control. Only after their actual
   approval advance the requirement to **`approved`**, recording truthful review
   provenance, the authorized audit-custodian `reviewer_id`, actual `approved_at`,
   and approved `effective_at`. Under the explicitly approved AI path above,
   this UUID is not a claim that the custodian performed human review. Do not self-approve, backdate,
   disable triggers, or manufacture review events. A material correction after
   approval requires a new governed version, not an in-place rewrite.
6. After deployment, isolation proof, and release authorization, the authorized
   publisher advances the approved requirement to **`published`**. Only then
   separately approve and publish the curriculum: its approval trigger requires
   every prerequisite/member already published and effective. Record actual
   `published_at`, never backdate publication to approval. Verify all referenced
   versions are published/effective.
   Insert a `learning.role_curricula` mapping only for `events/seller` to this
   curriculum version, with an explicitly approved role-wide `department_id=null`,
   effective date, and creator. Events have no department key, so a department-only
   mapping is not accepted as rollout proof. This maps learning; it grants no role
   to any user. Do not alter existing mappings. The planned effective time must be
   at or after actual publication, as required by the existing chronology checks.
7. For this UAT rollout, parent provisions only the explicitly approved synthetic
   test identity `intra.seller.uat.sep20@mwell.com.ph`, clearly labelled as synthetic,
   with `events.seller` only and no default `core.staff`. No SMTP is needed. Do not
   substitute a real seller. After the isolation hold is cleared, provision that
   identity's approved scoped role through
   the existing access-governance process. Refresh that user's normal Learning
   snapshot so the server materializes their assigned requirements. Open:
   `/onboarding?requirement=internal.role.events.seller.custody-practice.v1&next=%2Fevents`.
   The learner completes the prerequisite and each explicit challenge decision
   under their own identity. Use normal server attempts/checkpoints/evaluation;
   never insert progress, attempts, checkpoint evidence, or certificates by SQL.
8. Read back the learner's authoritative completed assignment and active scoped
   certification, then have the certified event owner enable the prospective event
   gate and named time-limited assignment. Verify a permitted own-event outcome and
   same-intent retry without duplicate custody movement before inviting that seller
   to operational use. Finance remains a different authorized actor.

## Readback and Recovery

Migration `20260920030900_event_seller_learning_readiness.sql` adds the private,
read-only `private.event_seller_learning_ready()` helper for the controlled Events
enable gate. It checks the exact two-member published/effective graph, independent
reviews, all six checkpoint rules, the sole capability outcome, and the effective
global seller role mapping. It has no direct public/anon/authenticated/service-role
execute grant. The authorized Events readiness RPC may call it under its existing
controlled authority; do not expose a new generic catalog-admin endpoint. A missing
helper or `false` result must prevent enablement. A `true` result proves neither
runtime deployment parity nor a seller's certification or event assignment.

Local check: `node --test modules/learning/tests/eventSellerLearningReadiness.pglite.test.mjs`.
This uses isolated contract tables and the actual helper SQL, not the full deployed
schema or a live account. Retain separate integrated migration and named-user proof.

Before release approval, retain exact persisted requirement/curriculum version IDs,
reviewer/owner/effective timestamps, the ordered membership and prerequisite graph,
the sole capability outcome, the role mapping scope, and deployed revision. In the
seller's server snapshot, check `requiredCheckpointIds` contains all six entries,
the source role assignment matches that named user, and orientation alone leaves
`record_event_outcome` locked. After their real attempt, retain server readback of
all six accepted checkpoints and certification state; refresh/read permissions at
the action boundary, not just the onboarding banner.

Rehearsal must reject another event, expired/unassigned seller, excess quantity,
ineligible/already-used/returned serial, duplicate reference, another seller's
reversal, missing challenge evidence, and settlement by the seller. Remaining
custody must prevent closure. Wrong choices must not record accepted checkpoints.

Missing training in the snapshot: check published/effective version and mapping
scope, then normal snapshot refresh. Unsupported practice: compare deployed
simulation ID/version and all six assigned checkpoints; correct through governed
publication, never bypass the challenge. Attempt limit reached: use the existing
Learning support/retry process; do not mark passed. Missing event access after
certification: check the individual event assignment/expiry and prospective gate,
not broad coordinator/admin grants. Rollback or suspend a faulty rollout through
authorized mapping/assignment retirement; preserve attempts, certification history,
immutable outcomes, and Finance evidence.
