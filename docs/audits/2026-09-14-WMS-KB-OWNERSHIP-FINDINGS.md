# WMS Knowledge Ownership Findings - September 14

## Scope

Independent, read-only review of the current KB against the canonical 31-capability warehouse catalogue and checked-in SQL authority. These are P2 guidance defects, not demonstrated authorization bypasses. No flow, grant, record or database rule was changed by this review. The role guides are improved, but the wider KB is not yet fully reconciled.

## Corrections Needed

| Area | Source / Node | Required Correction |
| --- | --- | --- |
| Putaway and receiving | `apps/shell/lib/knowledge/workflows.ts`, `receive-putaway`, `receive-record` | Remove Operations-only as a physical executor. Putaway uses `transfer_stock`; receipt uses `receive_stock`. Include canonical Operator/Supervisor where their actual command authority applies. Keep Procurement/Operations coordination separate from custody execution. |
| Inspection and holds | `workflows.ts`, `quality-start`, `quality-inspection`, `quality-release`, `quality-hold-review` | Inspection uses `inspect_quality`; continuing-hold release uses `release_quality_hold`. Do not imply that Procurement can release held stock. Separate acceptance inspection from a later hold-release decision and describe the actual actor-separation checks. |
| Allocation and issue | `workflows.ts`, `event-stock-ready`, `event-issue`, `allocation-reserve` | Separate demand preparation, reservation (`reserve_allocate`) and issue (`issue_items`). Marketing's reservation permission does not include issue. Events settlement uses the applicable Events permissions rather than Warehouse Operations alone. |
| Physical returns | `workflows.ts`, `return-start`, `return-quarantine`, `return-restock` | Distinguish customer-case coordination from physical intake (`manage_returns`), inspection (`inspect_quality`) and relocation (`transfer_stock`). Remove Operations-only as the restock executor. Submission of a customer case is not evidence of physical receipt. |
| Counts and adjustments | `workflows.ts`, `count-start`, `count-enter`, `count-revision`, `count-post` | Counting/recounting uses `cycle_count`. Keep configured supervisor/Finance approval groups and actor separation. Final approval posts the adjustment atomically; do not invent a separate general Finance/Admin posting button. |
| Readership versus execution | `apps/shell/lib/knowledge/content.ts`, feature and procedure control enrichment | Stop treating every audience role as an execution owner. Keep broad reading access, but assign each mutating control explicit capability-specific owners. Review Receiving, Fulfillment, Returns, Allocations, Storage, Quality and Purchase Orders first. |
| Action guidance | `apps/shell/components/knowledge/StepWorkspace.tsx`, role-requirement rendering | Explain the actor who performs a command without claiming all readers may execute it or denying a legitimate combined-role actor because of its display label. |

## Guard References

- `20260813203240_task_1_database_authority_remediation.sql`: issue, transfer and existing command-capability mappings.
- `20260826032845_converge_receipt_quality_custody.sql`: independent receipt inspection.
- `20260905095000_return_intake_certified_boundary.sql`: return-intake authority.
- `20260815163010_require_attributable_cycle_count_actor.sql`: attributable count authority.

Receipt inspection and hold release have distinct actor-separation checks. The inspected return-intake SQL does not establish the same receiver/inspector separation as receipt SQL. Do not claim universal server-enforced independence for every return action. Trace the complete return inspection/hold path and confirm the intended policy before proposing any new database restriction; a documentation correction must not silently change a business rule.

## Validation Plan

1. Build an explicit command-to-capability/owner map for these nodes from the actual RPC contract; distinguish read-only coordination and terminal results from commands.
2. Add failing semantic tests for Operations-only, Operator, Supervisor, Marketing reservation-only, Finance, Procurement and the combined operations identities. Do not just replace role labels globally.
3. Correct flow owners and procedure/control enrichment while retaining the same business transitions, route authorization and readership scope.
4. Test the resulting task guidance and decision workspace, including legitimate multi-role access and denied commands. Retain unverified screenshot status; matching role labels is not execution evidence.
5. Review rendered desktop/mobile guidance against live UI controls, update the standalone handbook and record any policy question separately from a software defect.
