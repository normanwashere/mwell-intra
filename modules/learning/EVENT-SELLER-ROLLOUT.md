# Event Seller Learning Rollout

Status: **candidate, pending deployment and governed catalog publication**.
This checkout registers a runtime, not live training, user access, or certification.
Do not treat local memory-mode completion as live evidence. No rollout step below
has been executed by this change.

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
5. Submit each draft to **`in_review`**. A different authorized reviewer verifies
   content, all six pass rules, graph, scope, retry/reversal controls, and source
   revision. Record the review evidence in change control. Only after their actual
   approval advance each version to **`approved`**, recording their `reviewer_id`,
   actual `approved_at`, and approved `effective_at`. Do not self-approve, backdate,
   disable triggers, or manufacture review events. A material correction after
   approval requires a new governed version, not an in-place rewrite.
6. After deployment and release authorization, the authorized publisher advances
   the approved requirement and then curriculum to **`published`**, recording
   actual `published_at`. Verify all referenced versions are published/effective.
   Insert a `learning.role_curricula` mapping only for `events/seller` to this
   curriculum version, with an explicitly approved role-wide `department_id=null`,
   effective date, and creator. Events have no department key, so a department-only
   mapping is not accepted as rollout proof. This maps learning; it grants no role
   to any user. Do not alter existing mappings. The planned effective time must be
   at or after actual publication, as required by the existing chronology checks.
7. Provision only the individually confirmed seller's approved scoped role through
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
