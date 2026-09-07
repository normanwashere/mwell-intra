# Independent Inactive Publication Binding Review

AUTOMATED, user-authorized independent review. Runtime: `06c9b80bc6c09c343800756ebcadc0efdb88619f`. Initial content-review artifacts are preserved. Reviewer and author UUIDs are agent identities; named UAT profiles are audit custodians, not human reviewers.

## Verdict

Latest main-reported live recheck: all three fingerprints remain unchanged (warehouse `63bd32726b57af27856d732707a4a137`, finance `deb60d391e7857938b0edc12ac346a71`, admin `0a4376c84b5a76f0823ffa177edf54ce`); no DML yet. Main independently reran the frozen internal tests: 5/5 passed. This corroboration is recorded here without changing review-artifact bytes, input digests or rendered SQL. It is not a claim that this reviewer queried UAT or executed the SQL.

Approved to render the three **inactive publication rehearsals**, with exact content/rules, candidate and conditional baseline bindings. Each `.review.json` is accepted by the frozen renderer through its matching `.input.json`. Each resulting `.rehearsal.sql` ends in ROLLBACK. No live execution was performed. **No apply or activation authorization is issued.** Main must freshly recheck the reported baselines and perform its controlled rehearsal before a separate exact-SQL execution decision.

| Key | Exact saved rehearsal SHA-256 |
| --- | --- |
| warehouse_operator | `b38f3d51218f6e74845cf399fec642057ff6bfae3415bf265147c731fdebf32b` |
| finance | `7907fa789b96c5a9c1fea4b268867a5402c722b24bb8da1a108ffb3ae4a94155` |
| admin | `e328d00a1686c39b5aa5d1ae50ff5c414919b5dd8bdc05f5b716848e65d68e45` |

## Reviewed Controls

- Frozen renderer bytes match binding manifest SHA `5b65be6b6faee16016c61cee0baf30afb1c7a7f08c407015b89c960406f2bf42`; Ops helper matches `a9827d2cd22b5e63fdd7685505b3937c7bc4afc9d0bf21dffe9cc00d5ef41839`.
- R2 corrected: both helpers derive SQL checkpoint outcomes from approved server `acceptedChoiceId`, matching the API and SQL outcome check. Approved definition hashes unchanged.
- Baseline query fingerprints curriculum/version, memberships, requirement versions, edges, outcomes and role mappings. SQL compares reported v1 fingerprint under graph lock, rejects existing newer versions/duplicate additive roots, copies existing memberships/edges/outcomes and checks unchanged baseline. Live fingerprint provenance remains main-reported, not independently queried here.
- Finance/admin each add one new requirement root. Warehouse adds quality, putaway and pick-pack roots, each mandatory and dependent on the existing practice requirement. New roots avoid competing versions of a single requirement in v2. Existing role grants are checked for each added outcome; no role capabilities are written.
- Requirements and curriculum follow draft -> in_review -> approved -> published with distinct pinned audit custodians. Composition is assembled before publication; existing published rows are not intentionally edited. Source grounding includes `20260812130000_learning_foundation.sql` lifecycle/composition guards and `20260812160000_learning_services.sql` assigned-checkpoint validation. This is source review plus rendering, not an independently executed full-DDL regression.
- Rendered publication SQL contains no role mapping insert, learner completion, assignment reset, certification write or business mutation. Inactive means unmapped, not secret: published content may be readable under existing published-content policies.
- Activation renderer is a separate gate requiring exact published-v2 fingerprint, compatible **public_alias** health and separate activation approval. Protected candidate health is insufficient. No activation input or authorization is generated here.

The renderer's apply path requires a separate execution artifact approving the exact rehearsal digest. These review inputs intentionally omit it. Do not hand-edit ROLLBACK into COMMIT or treat this content/binding verdict as execution approval. Re-rendering with a changed review timestamp/path/hash changes SQL and requires renewed digest review.

Deployment evidence: main reports exact protected runtime health at `2026-09-07T03:30:51.242Z`; not independently browser-verified by this reviewer. User-supplied UAT baseline observations are recorded in each review artifact and must still match at execution. No human pilot or operational certification is claimed.
