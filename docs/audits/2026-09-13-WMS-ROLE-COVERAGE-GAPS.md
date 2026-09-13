# WMS Role Coverage Gaps

Status: planning only; no new accounts, grants, session tests or live calls performed for this note. The full WMS contract remains 45 checkpoints / 88 checkpoint-view records. Hardware and pilot approval remain separate.

## What Is Established

Source: [audit identity scoping](../../scripts/qa/uat-audit-identities.mjs), [current job personas](../../scripts/qa/live-e2e-scenarios.mjs), [canonical warehouse capabilities](../../packages/rbac/src/modules/warehouse.ts), and [signoff contract](../../scripts/qa/wms-signoff-contract.mjs). `auditPersonas('checkpoint-v1')` scopes the same 11 job personas; it does not create 11 isolated warehouse roles.

The parent independently queried live UAT `core.profiles` / `core.user_roles` and confirmed all 11 configured personas. A subsequent raw administrative readback is retained at `outputs/wms-signoff/sep13-role-assignment-readback.json`, SHA-256 `ae6f2fc843ad6156d4628aaa09e6fc918df48a2d6bae258ec90a1eca1e689498`. It includes the query, target project and returned timestamps/assignments. The drafting agent reviewed source only; the parent owns the live readback. This establishes stored assignments, not ordinary-session authorization.

Five personas have exactly one **warehouse** role: `general_employee` = `business_unit`; `finance_controller` = `finance`; `leadership_insights` = `bi_analyst`; `marketing_events_lead` = `marketing`; `procurement_lead` = `procurement`. They retain other module roles and are not globally isolated identities.

`operations_associate` combines `warehouse_operator` + `operations`; `operations_lead` combines `warehouse_supervisor` + `logistics_supervisor`. Neither proves either constituent role alone. Neither matches the contract's required `warehouse_operator` + `warehouse_supervisor` multi-role combination. No checkpoint-v1 persona has `pricing` or `warehouse_admin`. UI presentation aliases and job titles are not authorization evidence.

Configured assignments and administrative SQL do **not** prove ordinary user-session authentication, governed capabilities, RLS visibility, mutation denial, or successful UI actions. In particular, `core.has_live_cap` explicitly permits `service_role`; an administrative call cannot substitute for a user call.

## Smallest Additive Roster And Matrix

Use the five existing single-warehouse-role personas without altering their grants. Subject to parent authorization, add six distinct isolated WMS accounts and one separate multi-role account, each in a new dedicated namespace with approved department membership and only necessary baseline core access. Do not rotate roles on existing testers or reuse an isolated-role session as a multi-role session.

The following are source-based starting probes, not live results or the complete capability matrix. Compare every declared warehouse capability against the installed registry and actual governed session before acting; stop on unexplained drift. Allowed examples require valid, run-owned prerequisites. A validation error on a malformed payload is not an authorization denial.

| Exact warehouse role | Existing persona / additive gap | First allowed UI + persisted proof | First forbidden probe |
| --- | --- | --- | --- |
| `warehouse_operator` | New isolated account | Receiving or scanned pick; exact custody/actor/stock | `request_fulfillment`, `release_quality_hold` |
| `warehouse_supervisor` | New isolated account | Quality hold release or independent stock approval | `set_pricing`, `manage_finance_close` |
| `logistics_supervisor` | New isolated account | Quality/receiving/controlled transfer; independent actor | `request_fulfillment`, `manage_finance_close` |
| `operations` | New isolated account | Ecommerce demand or customer-case intake; exact source | `receive_stock`, `issue_items`, `inspect_quality` |
| `finance` | `finance_controller` | Valuation/finance-close or finance stock approval | `issue_items`, `set_pricing` |
| `bi_analyst` | `leadership_insights` | Analytics plus source-row reconciliation | Inventory mutations and `set_pricing` |
| `business_unit` | `general_employee` | Own authorized department stock request | `reserve_allocate`, `request_fulfillment`, `issue_items` |
| `marketing` | `marketing_events_lead` | Campaign request/reservation in authorized scope | `request_fulfillment`, `issue_items` |
| `procurement` | `procurement_lead` | Warehouse procurement view/product maintenance | `reserve_allocate`, `issue_items` |
| `pricing` | New isolated account | Read-only pricing/valuation | `set_pricing` and inventory mutations |
| `warehouse_admin` | New isolated account | Warehouse configuration/import or control | `set_pricing`, `manage_finance_close`; unrelated module authority |

The seventh new account holds exactly `warehouse_operator` + `warehouse_supervisor` in WMS. Prove the combined grants, packer-release denial and applicable self-approval guards despite that union, then release with a different authorized actor. Reauthenticate/switch accounts in separate browser contexts and verify refreshed identity/capabilities and module/department boundaries. Keep the two existing combined personas as supplemental real-job coverage, not replacements for these checks.

For no-WMS coverage, use an ordinary existing persona with no warehouse assignment, such as `product_owner`, after fresh session verification, plus a genuinely anonymous session. Do not use `platform_administrator` as the representative nonprivileged denial actor. Never remove roles from an existing user to manufacture isolation.

## Commands And Required Proof

Offline commands available now, from the onboarding repository:

```powershell
node --input-type=module -e "import {auditPersonas} from './scripts/qa/uat-audit-identities.mjs'; console.log(JSON.stringify(auditPersonas('checkpoint-v1').map(p => ({persona:p.role,warehouse:p.assignments.warehouse ?? []})),null,2))"
node --test scripts/qa/wms-signoff-contract.test.mjs scripts/qa/wms-signoff-evidence.test.mjs
node scripts/qa/wms-signoff-evidence.mjs registry
```

There is now an offline seven-account planner, `scripts/qa/wms-role-provision-plan.mjs`, with 24 parent and 24 independent tests passing. It produces a frozen manifest, non-executable insert intentions and read-only collision/catalog preflight; it cannot create accounts. The parent prepared run `90c774b3-2d4d-42a0-b77f-5681a7e4fa06` under `outputs/wms-signoff/sep13-isolated-role-plan`, choosing the standard core.staff baseline and a constant existing Warehouse & Logistics member scope to isolate the role variable. The live read-only preflight found zero namespace collisions, active required roles/department and retained the 11 checkpoint-v1 assignment snapshots. Technical fixture choices are not human acceptance. See its `parent-review.md` and original `live-preflight-raw.json`.

There is no approved live executor or complete WMS role-matrix runner yet. **Do not run `node scripts/qa/provision-uat-intra-test-users.mjs` unchanged for this plan:** its CLI reconciles the selected existing roster, can delete mismatched roles/scopes, and can retire obsolete identities. It does not offer the reviewed append-only provisioning contract needed here. Existing journey runners also hardcode combined job personas; do not count their runs as isolated-role evidence.

Proposed next authorized integration, not executed:

1. Parent approves a manifest of seven new identities, exact role sets, department scopes and ownership. A narrowly reviewed provisioning operation must assert all new identities are absent and fail on collisions, create only those accounts and approved grants, and preserve a before/after snapshot of existing tester roles/scopes. No blanket reconciliation, emergency exception, certification bypass or fabricated training. Use ordinary governed onboarding where required; missing certification is a blocker.
2. Independently verify the exact UAT project/build and record current installed role/capability and RPC guards. Bound all assignment queries to the approved UUID list. Capture complete `core.user_roles` rows across modules and active `core.profile_department_scopes`, not just a filtered warehouse subset that conceals extra privileges. Administrative evidence establishes assignments only.
3. In each ordinary authenticated client, use `auth.signInWithPassword` and `auth.getUser`, then `client.schema('core').rpc('my_capability_snapshot')` and `client.schema('core').rpc('has_live_cap', { p_module: 'warehouse', p_cap: capability })` for each tested capability. Keep credentials/tokens out of artifacts. Archive actor UUID, query context, full returned capability arrays, assigned roles, department scopes, timestamps and actual errors/results. A capability Boolean alone does not prove the guarded business operation.
4. Execute each role's allowed and denied UI/direct-RPC probes at desktop1440 and mobile390. Use actual page/RPC contracts; examples include `warehouse.create_fulfillment_order`, `warehouse.advance_fulfillment_order`, `warehouse.inspect_quality`, and `warehouse.release_quality_hold`. For shipment completion retain `warehouse.update_shipment_tracking`; for department receipt retain the distinct acknowledgment operation. Do not substitute release for either completion.
5. For every negative probe, use an otherwise valid payload against owned test records and compare fresh before/after business rows, stock/reservations, movements, events and audit rows. For reads, assert permitted rows and explicitly out-of-scope synthetic rows. Test cross-department and cross-module boundaries according to the actual grants: broad authorized visibility is not automatically a leak, and not every foreign department must be denied for every role. Never use another tester's records as probe fixtures.
6. Retain source/build/run/view/actor bindings, original commands, fresh persisted readbacks, role and scope queries, reviewed screenshots, and byte/hash-bound private evidence. Require reviewed fixture/Storage cleanup, independent postcleanup and injected-failure cleanup evidence before contract credit. Do not fabricate absent capture fields or infer success from a route loading, a hidden button, an admin readback, or the offline verifier passing its tests.

Example read-only assignment query, with `$1` bound to the exact approved actor UUID array by the executor (not interpolated from unchecked text):

```sql
select p.id,
       coalesce(jsonb_agg(jsonb_build_object('module', r.module, 'role', r.role)
         order by r.module, r.role) filter (where r.user_id is not null), '[]'::jsonb) as assignments
from core.profiles p
left join core.user_roles r on r.user_id = p.id
where p.id = any($1::uuid[])
group by p.id
order by p.id;
```

Require the returned UUID set to equal the requested set; archive a separate exact-ID active department-scope readback. This query neither logs in those users nor proves their permissions.

## Credit And Ownership

The role slice requires 22 single-role checkpoint/view records, two multi-role records and two no-access records: 26 of the unchanged 88. None is awarded by this roster note. A separate role runner/evidence adapter is still missing. Physical scanner/camera/device/network/custody tests and named-user pilot approval stay independent, including legitimate training/support/rollback and parent release approval. Parent owns provisioning authorization, any future live dispatch and release.

Received55 remains retained: external-writer isolation is not established. New role provisioning or assignment readback is not an isolation attestation and does not authorize that cleanup.
