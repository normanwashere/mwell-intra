# Prospective Event Custody

Candidate only. No migration, user provisioning, certification, SMTP change or
business mutation was performed against UAT or production. The local visual
proof uses actual EventsApp, AppShell and controls with an isolated mock session
and RPC transport. It is not live authorization or migration certification.

## Activation Checklist

1. Obtain release approval and test the actual migration chain on an isolated
   PostgreSQL environment. Apply `20260920025525_gated_event_seller_custody.sql`
   and Learning's `20260920030900_event_seller_learning_readiness.sql` through
   the normal migration process. Ship matching Events, RBAC, navigation and
   Learning source. Schema presence alone cannot attest runtime release parity.
2. Follow `modules/learning/EVENT-SELLER-ROLLOUT.md`: contribute the seller
   requirement and curriculum as drafts, obtain independent review/approval,
   publish the effective approved versions, and map only the approved global
   `events/seller` curriculum. Do not insert learner certificates or auto-qualify.
   The exact requirement is `internal.role.events.seller.custody-practice.v1`;
   the simulation is `event-seller-custody-v1`.
3. Use the existing authorized identity administration process to create or
   confirm each real seller's own named, active employee account and verified
   email. `/admin/users` manages roles for existing profiles; it is not a new
   account-provisioning service. An authorized RBAC administrator assigns only
   `events.seller`, optionally the existing `core.staff` read baseline. No other
   module roles are accepted, including Warehouse or Events coordinator/admin.
   Shared accounts, fictitious email accounts and temporary broad grants are
   not supported. No account provisioning was executed during this task.
4. Seller signs in normally and completes required learning at
   `/onboarding?requirement=internal.role.events.seller.custody-practice.v1&next=%2Fevents`.
   Refresh the verified capability snapshot. Role assignment and publication
   do not grant live mutation qualification; `core.has_live_cap` remains the
   independent authority at every seller write. Seller-only claim parsing and
   actual AppShell navigation are locally tested; live login remains release proof.
5. Event owner with effective `events.manage_events` opens a NEW event at
   `/events/<id>`. Before creating the demand/order or issuing stock, check
   Event custody setup: server schema, seller capabilities and learning
   publication must each show ready. Call the owner-only readiness RPC below
   and retain its JSON result. Missing helper, absent role/cap/rule, disabled
   trigger or unpublished learning fails closed. Nothing automatically enables
   an event, and old events are not mass-migrated.
6. Owner explicitly selects **Enable prospective custody**, then assigns each
   named seller by exact email. Assignment is bounded to the stored event dates
   at Asia/Manila midnight, intersected with current event dates. Rescheduling
   cannot silently extend authority; the owner must explicitly reassign.
7. Submit ONE multi-line stock demand using **Request warehouse stock**. The
   existing `request_event_fulfillment` stores one department request with its
   `lines[]`; existing approval and fulfillment remain authoritative. Each
   line shows requested, current eligible, shortage, treatment and next owner.
   Availability is indicative, not a reservation. No extra Warehouse issue is
   called by Events. Merchandise still requires expense treatment.
8. Complete the existing approval, directed picking, release and independent
   receipt acknowledgment. Only exact prospective order/movement/unit lineage
   creates the immutable custody source. An acknowledgment retry does not
   issue stock or create another projection. Historical unresolved serials
   fail closed. Legacy reserve/issue paths cannot enter a gated event.
9. Assigned sellers record their own sales/giveaways against acknowledged
   remaining allocations. Serialized stock requires exact eligible serials;
   bulk quantities are bounded. Reuse the same idempotency key on uncertain
   retries, and use an event-unique external reference. Correction is an
   attributable reversal by the ORIGINAL seller with a reason and a new
   reference, while the existing event/assignment/settlement window permits it.
10. Existing authorized Warehouse return intake (`record_return_v2`) accepts
    exact unsold/ungiven allocation quantities and serials into quarantine.
    Existing Quality authority and the separate PRODUCT-approved stock recovery
    recipe govern conversion; Events never fabricates a recovered serial link.
11. Finance reads canonical totals and retains independent settlement approval.
    Submission/approval requires no outstanding demand/handover, zero remaining
    custody and physical return totals matching the ledger. New source/demand
    is blocked after submission/approval. Loss/damage/re-kit exception counters
    are deliberately unsupported by this bounded ledger and fail closed; do
    not disguise them as sales or returns. Escalate for governed policy review.
12. Owner can revoke one seller or disable seller posting with an audited
    idempotent setup command. Disabling does not erase history or bypass
    controlled returns. After assignment expiry, contact the event owner for
    governed correction review. No post-event extension policy is implemented.

## Shared RPC Contracts

All exposed RPCs below run in the existing authenticated session, never with a
client-chosen actor. Commands take `{ payload: {...} }` and a stable
`idempotency_key`; read RPCs do not require a key.

```js
const warehouse = authenticatedClient.schema('warehouse');
await warehouse.rpc('event_custody_readiness', { payload: { event_id } });
// { schema: boolean, capabilities: boolean, learning: boolean, ready: boolean }
await warehouse.rpc('configure_event_custody', {
  payload: { event_id, action: 'enable', idempotency_key }
});
// Other setup actions: disable; assign + seller_email; revoke + user_id.
await warehouse.rpc('my_event_custody_events', { payload: {} });
await warehouse.rpc('event_custody_ledger', { payload: { event_id, offset: 0 } });
// allocations, own/all entries and totals, next_offset; 100 entries/page.
await warehouse.rpc('record_event_outcome', { payload: {
  event_id, allocation_id, kind: 'sale', quantity: 1,
  serial_numbers: ['EXACT-ISSUED-SERIAL'], amount: 125,
  external_reference: 'EVENT-RECEIPT-001', idempotency_key
} });
// Giveaway amount must be zero. Reversal: kind, allocation_id, reverses_id,
// reason, new external_reference, new idempotency_key; quantities derive on server.
```

Internal SQL APIs (no direct authenticated/service-role execute grants):

- `private.event_allocation_remaining(allocation_id text) returns jsonb` exposes
  source identity, issued/returned/sold/giveaway/remaining units, `serialized`
  and exact `eligible_serials`. Missing or historical ambiguous lineage raises.
- `private.assert_event_conversion_return(return_id text, allocation_id text,
  event_id text, product_id text, serial_number text) returns void` takes event
  then allocation locks and validates the exact physical return/source with no
  active sale/giveaway or later source reuse. The recovery owner handles actual
  Quality/stock-state/recipe approval and destination serial creation.
- `private.event_seller_learning_ready()` is Learning-owned, read-only and
  checks exact independently approved published global seller curriculum.

## Local Proof And Remaining Evidence

Run with Node 24 and the existing workspace dependencies:

```powershell
pnpm --filter @intra/events test
pnpm --filter @intra/events typecheck
pnpm --filter @intra/rbac test
pnpm --filter @intra/rbac typecheck
node modules/events/tests/custody.pglite.test.mjs
$env:EVENT_VISUAL_OUTPUT='<absolute evidence directory outside the checkout>'
node modules/events/tests/custody.visual.mjs
```

The SQL fixture uses real retained acknowledgment and return command functions,
including their replay boundaries. Identity/certification responses, learning
readiness and stock availability are explicit fixture stubs; release movements
are seeded. PGlite queues submissions in one connection: its competing-submit
test is NOT native independent-session PostgreSQL contention proof. No `docker`,
`psql` or `pg_ctl` executable was found locally.

Pending release evidence: native concurrent transactions/deadlock ordering;
complete migration-chain application; actual release -> independent acknowledgment
-> return + Quality -> approved recovery pipeline; real named seller provisioning,
login, learning certification and scoped RLS read/write; runtime/schema parity.
The existing read-only UAT Next server at `http://127.0.0.1:3031` has NOT received
these migrations. Simulated screenshots cover owner disabled/assign/revoke,
multi-line demand, seller posting/history and Finance readback at 1440/390/320.
The canonical `/warehouse/events` redirect to `/events` is unchanged.
