# Vendor Evidence Publication Draft and Review Packet

Status: PREPARED LOCALLY; NOT INSERTED, REVIEWED, APPROVED, OR PUBLISHED.
Target: UAT `kkoitlvydytdhlpxhuah` only. Date: 2026-09-06.

## Concrete Blocker

Proceed authorization is not independent content approval. No authenticated
content owner or distinct human reviewer has been designated for this change.
Do not reuse synthetic test identities from older publishing scripts as human
signoff. No live writes were made while preparing this packet.

The installed `learning.guard_content_lifecycle()` was read directly. Supported
transitions are `draft -> in_review -> approved -> published` (or scheduled).
Both version tables require `reviewer_id <> owner_id` and `approved_at` beyond
review. Publication requires effective/publication timestamps and validates the
curriculum graph. Approved content and published composition are immutable.
These database constraints do not establish that a named person actually reviewed
content; recording that evidence requires a real review.

Installed RLS permits an active internal platform administrator to manage this
platform-owned content. Supported repository precedent is an explicitly scoped
transactional publisher, such as `scripts/publish-marketing-reservation-training.mjs`,
using the ordinary learning tables with their lifecycle guards enabled, under
READ COMMITTED. It is not permission to copy that script's synthetic attribution.
No self-service publication UI or publication RPC was established by this review.

## Exact Requirement Draft

- Requirement key: `vendor.vendor_representative.evidence-and-acknowledgments.v1`.
- Requirement version: `1`; initial version status: `draft`.
- Audience: `vendor`; kind: `attestation`; governance owner: `platform`.
- Owner department: null. Root status: `active`.
- Title: `Vendor evidence and acknowledgments`.
- Simulation ID: `vendor-evidence-review-v1`, simulation version `1`.
- Mandatory curriculum membership: true; waivable: false.
- Prerequisite: published version 1 of `vendor.vendor_representative.orientation.v1`.
- Capability outcomes: none. No additional business authority.
- Assessment settings: `{}`; passing score and max attempts: null.
- Proposed estimated duration: 3 minutes (requires owner/reviewer confirmation).
- Proposed materiality: `material`, because this adds a mandatory obligation.
- Change reason: `Add the vendor evidence learning review to the vendor role curriculum without replacing legal declarations or granting operational authority.`
- Source references: application simulation `vendor-evidence-review-v1` version 1,
  `modules/learning/src/catalog.ts`, and this review packet, bound to candidate
  `0363ae28843d474bcb0efd4802bb91f15c9b135b`. The preparation script reads that exact
  Git object, not the working tree, and records its SHA-256 in source references.
  Verified catalog SHA-256: `b43d781bb62ea4db83eac1f61eb3dc73e2338eb3685fb28e5b2f3efa8b0cee48`.
- `created_by` and `owner_id`: actual designated author, not populated in this packet.
- `reviewer_id`, `approved_at`, `published_at`, and `effective_at`: unset at draft.
- Content reference: null. The installed checkpoint validator uses `simulation_id`
  and `pass_rules`, not this optional reference; the existing orientation publisher
  also leaves it null. Candidate embedded content resolves by simulation ID.
- Confirmed pass rules:

```json
{"required_checkpoints":["review-evidence","complete"],"checkpoint_outcomes":{"review-evidence":["reviewed"],"complete":["reviewed"]}}
```

Read-only inspection of installed `learning.record_simulation_checkpoint(jsonb)`
confirms attestation is supported, requires a current published version, caller-owned
in-progress assignment/requirement/attempt, validates checkpoint membership and
allowed outcomes, deduplicates event keys, and passes only when every required
checkpoint has evidence. It does not enforce checkpoint order or prove a legal
signature, actual document review, or human comprehension. No server change is
needed for this completion contract. Unknown checkpoints and outcomes remain denied.

Exact candidate simulation content:

1. Checkpoint `review-evidence`, outcome `reviewed`, title `Review evidence responsibilities`:
   "Review the current document checklist in your vendor case. Prepare accurate, current company evidence and address missing or expired documents before submission. This learning review does not upload or approve documents."
2. Checkpoint `complete`, outcome `reviewed`, title `Keep legal declarations separate`:
   "Declarations, acknowledgments, and signatures must be completed by the authorized vendor representative in the actual application. Completing this learning review does not sign a document, make a legal acknowledgment, submit an application, or grant accreditation."

## Exact Curriculum Proposal

Read-only UAT verification found the role curriculum
`vendor.role.core.vendor_portal.capability-practice.v1.curriculum` version 1
published, ID `f2fe918c-45fc-4db0-a11e-1ed352a23f45`, platform-owned.
Create a NEW version 2 of this same curriculum, initially draft, referencing
version 1 through `supersedes_id`. Do not edit version 1 or supersede it during
draft preparation. Use the same proposed materiality/change reason as above.

Proposed ordered mandatory composition:

| Order | Requirement | Version |
| --- | --- | --- |
| 0 | `vendor.vendor_representative.orientation.v1` | 1 |
| 1 | `vendor.vendor_representative.evidence-and-acknowledgments.v1` | 1 |
| 2 | `vendor.role.core.vendor_portal.capability-practice.v1` | 1 |

Preserve the existing practice-to-orientation prerequisite. Add the new
evidence-to-orientation and practice-to-evidence prerequisites. The latter is
explicitly present in candidate `0363ae28843d474bcb0efd4802bb91f15c9b135b`;
the earlier packet omitted it and was not graph-equivalent to that candidate.
Preserve the sole verified capability outcome: the existing practice requirement
maps to `core.submit_accreditation`. Evidence has no outcome.

Leave `vendor.vendor_representative.baseline.v1` version 1 unchanged: it contains
only orientation. The candidate adds evidence to the vendor role curriculum,
not the baseline. Preserve existing requirement versions, assignments, attempts,
completion evidence, and certifications. Review the resolver's treatment of a
new material curriculum before publication; do not force reassignment or reset
existing users to manufacture fresh completion evidence.

Installed `private.resolve_vendor_learning_assignments()` joins EVERY current
vendor role mapping to a current published curriculum and deduplicates by caller,
curriculum version, role source type and role-assignment ID. Therefore adding an
active version-2 mapping affects existing vendors at their next resolution too:
it creates a new assignment rather than replacing their old one. `materiality`
is not a rollout filter in that function. Leaving version 1 mapped means both
versions can be assigned. Publication without a role mapping does not activate
this role assignment path. Do not add a mapping until this non-fresh-only impact
is explicitly reviewed. No certification reset or grandfathering policy is implied.

Installed `learning.resolve_assignments()` calls the base resolver, role cleanup,
vendor resolver and shared-completion sync, and still propagates same-audience
orientation credit by normalized title (excluding corrective/retraining sources).
Existing orientation/practice credit may be reused; the new attestation is not
an orientation and must not be represented as a fresh attempt through shared
orientation credit. This publication does not change the live sharing policy.

## Human Review Checklist

- Designate a real authorized content owner and a distinct reviewer; obtain their
  explicit review of this exact content and curriculum change, not just deployment.
- Confirm platform governance with appropriate Legal review of the boundary text.
- Confirm duration, the documented completion contract, source hash, materiality, rollout
  effective time, and existing-learner impact before making the draft executable.
- An authorized platform administrator can create the root/version and curriculum
  draft through the guarded table mechanism, then submit both to `in_review`.
  Keep all approval fields null until an actual independent review is complete.
- Publish the reviewed requirement before approving/publishing its new curriculum,
  so graph validation sees current published dependencies. Use real timestamps.
- Rehearse the exact scoped publisher against actual SQL locally, including
  independent-review denial, graph validation, idempotency, and unchanged old rows.
- Verify the published identity, kind, simulation, graph, and outcomes read-only;
  separately validate fresh vendor completion after the corresponding app deploy.

This packet is prepared review content, not an executed SQL draft or a claim of
human approval. Authority migration/deployment belong to main. Telemetry remains
disabled and outside this publication task.

## Executable Preparation

`scripts/publish-vendor-evidence-learning.mjs` renders a scoped draft SQL rehearsal.
Despite its publisher filename, it has NO commit/publication mode, network client,
role-mapping writes, approval writes, or learner-evidence writes. SQL ends with
ROLLBACK. Do not run even the rehearsal against UAT before human review: a rollback
is still a live write transaction. Local PGlite tests are the only execution so far.

Command after actual human review, to render only:

```text
node scripts/publish-vendor-evidence-learning.mjs <local-review-input.json>
```

Required JSON fields: `projectRef` (exact UAT), `candidate` (exact SHA above),
`ownerEmail`, `reviewerEmail`, `reviewEvidence` (HTTPS reference to actual review),
`reviewedAt` (actual timestamp), and `reviewConfirmed: true`. There are no defaults;
known synthetic/test identities, identical actors, unknown fields, commit flags,
missing review evidence and other targets are rejected. Input validation cannot
authenticate a person's signoff: the executing administrator must verify the
evidence. SQL requires active employee identities and an active platform-admin
owner. Neither actor is impersonated through JWT settings. Reviewer fields stay
null on the rehearsed drafts.

The rehearsal fails on existing target content rather than overwriting it and
can be repeated after rollback. It copies existing prerequisite/outcome rows,
adds the evidence-to-orientation and practice-to-evidence edges, and leaves old
rows unchanged. It fails closed on baseline prerequisite/outcome drift and checks
that all three proposed edges resolve within the curriculum in ascending order,
which excludes cycles. Evidence receives no capability outcome. Actual-SQL tests
assert exact edges (1 -> 0, 2 -> 0, 2 -> 1), rollback preservation, and drift denial.
This is draft preparation, not a tested production publication/activation tool.

Verification: `node --test scripts/publish-vendor-evidence-learning.test.mjs`:
3 passed, including actual foundation table constraints/content lifecycle in
PGlite and repeat rollback preservation. The local fixture does not claim full
installed RLS, graph-publication or RPC end-to-end certification.
