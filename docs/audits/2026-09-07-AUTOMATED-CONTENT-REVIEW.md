# Independent Automated Content Review

Date: 2026-09-07. Mode: **AUTOMATED, explicitly user-authorized**. Reviewer: `01a06fa2-a909-7bd0-84a1-90c820ec9c5f`, label `independent-content-reviewer`; candidate author: `01a06fa0-d12a-73d0-a143-5e6c7f3a745e`, label Curie; draft SQL/renderer author: `01a072be-8370-7621-8090-b3b44baa8cc6`, label Godel. These agent UUIDs were supplied by the user from tool context on September 7; they are **not database principal IDs**. Vendor catalog authorship remains unknown. The reviewer did not author the reviewed learning definitions or correction renderers. Unrelated UI changes authored by this reviewer are excluded.

This provenance-only update leaves approved content hashes and verdicts unchanged. Audited database actor binding will be reviewed in a **separate artifact**, after the final renderer and candidate are supplied; this record does not authorize execution.

Authorization reference: this task's September 7 user direction, relayed as “none...purely vibe coded...spawn separateagent review”, followed by the explicit request for independent automated review. This is not human approval, a human pilot, learner completion, or operational certification.

## Current Decisions

Hashes below were independently recomputed from the actual exports using SHA-256 of UTF-8 `JSON.stringify(value)`, without sorting keys. A changed byte sequence requires a new decision. The adjacent JSON is a content-review record, **not executable publication authorization**. Candidate commit and live baseline fingerprints remain unknown/null; no prior deployment is substituted.

| Subject | SHA-256 | Decision and scope |
| --- | --- | --- |
| Corrected stable warehouse definition | `03ac69bd9e0ecf09898af99ac706085ea17f1860b222c1b3fa36f98efed062c8` | **APPROVED** for runtime registration and publication content, not deployment or SQL execution. R1 corrected and independently re-reviewed. |
| Stable payment definition | `901e4ee97aec872dd7efd4cc2d7975c59f15dfdedd8a29f986201d3072c6ac2b` | **APPROVED, content only**. Eligible content for runtime registration; actual evaluator wiring and publication binding not approved here. |
| Corrected combined server rules/negative feedback | `deeb1dff8e5fa2998e59655bb66511a78a20becb5e01f8fafaaa8fd631f65a98` | **APPROVED** for runtime registration and publication content. All six keys and twelve negative feedback alternatives reviewed. |
| Vendor evidence simulation | `508c2518986fa444810c659fd55b846d22f3873f72a4149b67762c8e6cef9391` | **APPROVED, learning-attestation content only**. Not proof of actual evidence submission or legal acceptance. |

## Findings and Source Grounding

### R1: Warehouse unknown outcome, corrected in current approved bytes

Current instruction, context, selected answer and rejected release feedback now consistently state that failed/lost response does not establish whether a decision was recorded. They require exact-source readback before retry or handoff and preserve custody restrictions and separate disposition authority. This resolves R1. The following paragraph records the rejected earlier bytes, not a remaining defect in the current candidate.

`scopedReadinessCandidates.ts`, checkpoint `confirm-handoff`, says “A failed inspection response is not a recorded decision.” A response can be lost after commit. The separate instruction to recheck the source does not make this opening assertion true. Rules feedback for `release-anyway` similarly says an attempted inspection “is not a recorded result”. Change both to lack of proof: failed/lost response does not establish whether the decision was recorded; read back the exact source before retry or handoff. Do not imply a blind new submission is safe. Rejection relayed to main for Curie; reviewer has not edited authored content.

The remaining warehouse choices and keys are appropriate: exact source rather than same SKU; supported hold rather than urgency; no receipt rewriting or unauthorized dispatch. [InspectionSheet](../../modules/warehouse/src/components/quality/InspectionSheet.tsx) lines 57-61 disables submission while evidence is busy, for missing non-accepted reason, or missing required evidence. The [provisional hold release migration](../../supabase/migrations/20260905180530_authorize_accepted_provisional_quality_hold_release.sql) separately constrains release of pending independent-inspection holds. These support the source, evidence and custody instructions, not a claim of successful physical inspection.

### Payment: Content approved, no claim of complete enforcement audit

All three selected keys are appropriate: `return-owner`, `return-current`, `readback-handoff`. All six rejected alternatives receive specific corrective feedback rather than generic failure. “A rejected or lost response is not proof of either action succeeding” correctly states uncertainty; it does **not** say the action did not commit. Readback is the next action and release remains separately authorized.

[PaymentReadinessPanel](../../modules/procurement/src/components/PaymentReadinessPanel.tsx) describes warehouse custody, requester acceptance, Procurement evidence and Finance review as separate attributable decisions. [Policy-alignment DDL](../../supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql), `private.policy_assert_payment_pack_current`, `procurement.review_payment_readiness` and `procurement.release_payment` (around lines 4783-4845), checks current evidence, accepted transition, supported evidence and separate release with payment reference/date and remaining balance. [September remediation](../../supabase/migrations/20260905090000_procurement_remediation.sql) preserves correction handling for stale/returned invoice packs.

The preparer/self-review instruction is appropriate separation-of-duties guidance. This review does not assert that every payment-pack RPC enforces preparer identity separation: the inspected review function body does not itself compare `prepared_by` with `auth.uid()`. Do not convert content approval into a security-enforcement certification; any such claim needs a separate complete wrapper/trigger review. No new enforcement defect is claimed solely from that partial chain inspection.

### Vendor: Genuine learning pass rules, not fabricated acceptance

[Catalog](../../modules/learning/src/catalog.ts) defines `vendor-evidence-review-v1` as two review steps with `reviewed` outcomes and no capability outcomes. The requirement kind is `attestation`, not a scored operational scenario. [Vendor renderer](../../scripts/publish-vendor-evidence-learning.mjs) requires **both** `review-evidence` and `complete`, each with outcome `reviewed`. It does not insert learner completion or signature evidence. The content explicitly distinguishes current company documents from actual application declarations, signature, submission and accreditation.

[VendorApplicationPage](../../modules/legal/src/pages/VendorApplicationPage.tsx) lines 328-355 separately validates signature and application fields, then sends `expected_version` and a submission idempotency key. [Vendor case workflow](../../modules/legal/src/vendorCaseWorkflow.ts) distinguishes editable draft/correction state from read-only submitted state. The learning review does not perform these business operations.

## Version SQL Review: Separate Gate

The inspected vendor proposal creates a draft v2 curriculum containing orientation, new evidence attestation and existing practice. It retains practice-to-orientation and adds evidence-to-orientation plus practice-to-evidence: three acyclic, same-curriculum prerequisite edges in increasing member order. Only the old practice retains `core.submit_accreditation`; the new attestation grants none. It preserves published v1 and does not synthesize completion. This graph's **semantics are approved**; execution is not.

Raw SHA-256 of inspected vendor renderer: `148b889ad842753bdbee1dd869bc22644bf12141e9fcca8ba90cf71071ec0fec`. Raw SHA-256 of inspected mapping renderer: `028ddc794fb428e8c5a76347d16c5fcb9f219192e194280ea69a03151098408b`. These identify inspected script snapshots, not final correction SQL or approved candidate content hashes.

The mapping proposal preserves existing requirements, edges and outcomes, adds a mandatory new version after prior requirements, and restricts the new outcome to the intended capability; procurement_officer is excluded. Both inspected scripts are rollback rehearsals. Their old human owner/reviewer input wording is superseded by the user's automated-review direction, but Godel's revised audited actor contract must still be reviewed. Do not run old renderers as publication approval.

Content and server feedback are now approved for registration; actual runtime registration/evaluator integration remains to be verified. Publication execution remains blocked until revised renderer, rendered SQL, audited actor identities, final candidate commit and current baseline fingerprint are bound and checked. Graph preservation must include unchanged existing learner evidence and no capability expansion. No live SQL was executed in this review.

## Retained Rejected Evidence

## Runtime Integration Follow-up

Independent source review approves the frozen catalog/evaluator integration: catalog adds only the two approved simulations, rejects wrong audience/non-scenario kind, and does not alter default requirements or curricula. The server evaluator imports the approved rules; the public learning barrel and catalog do not import/export those rules. Repository-wide import inspection found production evaluator usage in the server API route, not client components. This is source-level key privacy verification, not a production bundle scan. Independently ran `scopedReadinessCandidates.test.ts` and `simulationChoiceAuthority.server.test.ts`: **8/8 passed**, exit 0. These pin content/rules hashes, catalog preservation and accepted/rejected callback behavior.

**R2: Publication binding rejected pending correction.** The current mapping renderer builds `checkpoint_outcomes` from `step.outcomeId` (checkpoint names), while `apps/shell/app/api/learning/simulation-choice/route.ts` sends `outcome_id: command.choiceId`. The actual `learning.record_simulation_checkpoint` definition in `20260812160000_learning_services.sql` rejects outcomes not in the published allowed list. For example, `exact-source` is not `confirm-source`; all six accepted answers have this mismatch. Derive allowed outcomes from the approved server rule's `acceptedChoiceId` and test the API-to-pass-rules contract for all six. No approved content hash needs to change. Main notified immediately. The renderer also retains stale `runtime_status: unregistered...` provenance that must be corrected before binding.

The inspected automated renderer checks exact review artifact digest, content/rules digest, distinct agent identities, candidate/project/key/baseline, authorization reference, and a separate rehearsal SQL digest before apply. Its SQL checks baseline before/after copying graph, preserves original memberships/edges/outcomes and adds a new requirement root. These controls do not resolve R2, verify a live fingerprint, or authorize execution. Supplied UAT fingerprints remain main-reported until the separate final binding review.

## Historical Hashes

## Additional Ops Custody Content Review

Independent automated reviewer `01a06fa2-a909-7bd0-84a1-90c820ec9c5f`; author Curie `01a06fa0-d12a-73d0-a143-5e6c7f3a745e`; same explicit user authorization. **APPROVED for content and eligibility for future runtime registration**, not actual integration, assignment activation, SQL execution or physical competency. These additional simulations are not registered in ready runtime `9c9bef1aa71a02b9ea0f9e391472d7ee09cc817f`.

| Export | Independently reproduced SHA-256 | Verdict |
| --- | --- | --- |
| Putaway definition | `444e9c98a0f18cd5099076a5b476b1d93d5fdf23c351dfad481c7d0674a5ba76` | Approved |
| Pick/pack definition | `d46411fbf73f14c9ef20cc8814e5733bd5fb6cddd65fb2c53c520993a5f31470` | Approved |
| Ops server keys and feedback | `0353e6083a2f33d426a5078833451dfec6ec804546c022a62d70c605eda4e87f` | Approved |

Reviewed all six decisions and twelve rejected alternatives substantively. A read-only bundled-export check independently reproduced the hashes and passed unique accepted-choice/complete negative-feedback assertions for every checkpoint. Accepted choice `verify` is scoped by simulation and checkpoint, not a global completion token. Future SQL pass rules must use accepted choice IDs, not `step.outcomeId`, per R2.

Source grounding: [StorageAreasPage](../../modules/warehouse/src/pages/StorageAreasPage.tsx), source eligibility around lines 140-199, quantity/destination validation 305-339 and remaining-task readback 350-353, supports exact source, unbinned eligibility, one serialized unit, bounded positive whole quantities and active same-warehouse bins. Content does not claim destination selection releases a hold or partial movement completes all work. Its lost-response instruction and feedback correctly allow commit uncertainty and require readback before retry.

[FulfillmentPage](../../modules/warehouse/src/pages/FulfillmentPage.tsx), pick source scanning around 1496/1603-1653 and packing 1827-1863, supports the selected order, eligible stock, source/serial verification, pending evidence blocking, HTTPS shipment links, delivery details and packaging capture. [Fulfillment release DDL](../../supabase/migrations/20260828011200_fulfillment_zero_line_backorder.sql), lines 153-157, rejects release by `packed_by`. The correct handoff explicitly says a different **authorized** operator; it grants no release authority to the learner. `reserve_allocate`/`issue_items` are declared learning outcomes, not a role grant. Scope excludes authority expansion and must retain existing role capability checks at later binding.

No blocking content finding. The static repeated `verify` choice ID is not by itself certification evidence; only the server evaluator plus assigned-requirement/attempt checks and approved pass rules can record progress. This review is not a fresh live transaction test, bundle privacy scan or claim that all inventory modes require a physical bin (the source also supports its existing general-stock-area path).

Stable warehouse hash `98da2e8123dde0b28b873335578cec1893b1bdb4ba9e9012bcde2d79bd8327a8` and combined rules hash `716b2a3a408cf748fe1b0db7001374db9b6610a2f303a9b3afc72115b7a1c685` remain rejected historical snapshots for R1. Their approval was not retroactively changed.

Earlier unregistered warehouse draft hash `0bfe99fbc8c3f3294783def56af07f52d7231bc50eb3e0cad3d1d9986a00e612` has the same R1 defect and remains rejected. Earlier payment draft hash `05cd99bcea0e44b4b76c7d4ffe9a8db2e08f29cce5fc755176362e446ad3773a` is superseded by the stable ID, not silently approved for registration. Proposed old combined key hash `0caac9b8e28f7253613dbab5ae1892c5781a8de3dac76fd142bbb0bb06be5966` is not installed authority.

Verification performed: source inspection, all six candidate decisions and twelve negative feedback alternatives reviewed, corrected export hashes independently recomputed. A read-only structural assertion passed for all six checkpoints: exactly one accepted choice and feedback for every rejected choice. No live capture, business writes, pilot results, runtime integration test pass or publication execution is claimed.
