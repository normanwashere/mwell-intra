# Sep7 Merchandise UAT Fixtures

Target: `kkoitlvydytdhlpxhuah` only. This renderer never connects to a database.
The executor must verify the MCP/SQL connection targets that project before running
either artifact. The literal project binding is not proof of a SQL connection's identity.
No service key, login, role grant, policy change or existing-row update is needed.

- Company D: `UAT-SEP07-PO-0005`, jacket S/M/L, 100 pieces each.
- Company E: `UAT-SEP07-PO-0006`, tumbler, 300 pieces.
- Expected arrival: 2026-09-08, explicitly a synthetic test date, not confirmed delivery.
- New isolated products only; `uat-prod-tumbler` is untouched.
- Product barcodes: `MWUAT-SEP07-JACKET-S`, `MWUAT-SEP07-JACKET-M`,
  `MWUAT-SEP07-JACKET-L`, `MWUAT-SEP07-TUMBLER`. These are internal product/variant
  barcodes, not per-unit serials or externally registered GTINs.
- Synthetic PHP costs: jacket 500/piece (PO total 150000), tumbler 150/piece
  (PO total 45000). No supplier quote or actual commercial value is asserted.
- POs start issued solely as explicitly authorized synthetic receiving setup.
  No approval signatures, human approver IDs, approval timestamps, accreditation
  approvals, acknowledgement, delivery evidence, receipt or inventory is invented.
  Linked requests remain draft goods context; this is not approval-path certification.
  Vendor master rows remain draft. Policy blockers for other workflows are intentional.

## Commands

From repository root in PowerShell:

```powershell
node --test scripts/qa/uat-sep07-merch.pglite.test.mjs
$env:SUPABASE_PROJECT_REF='kkoitlvydytdhlpxhuah'
node scripts/qa/render-uat-sep07-merch-sql.mjs --out scripts/qa/uat-sep07-merch.rehearse.sql
node scripts/qa/render-uat-sep07-merch-sql.mjs --apply --out scripts/qa/uat-sep07-merch.apply.sql
```

Both commands only render files. Default SQL ends ROLLBACK; `--apply` SQL ends COMMIT.
`--out` refuses to overwrite an existing artifact. Main owns review and live execution.
Run rollback rehearsal first against the selected UAT project to validate its complete
installed FK/trigger chain, then apply the reviewed artifact. No live rehearsal was
performed by the implementation agent; live calls were schema/function SELECTs only.

After apply, main MUST run `scripts/qa/uat-sep07-merch.ops-readback.sql` on the verified
UAT connection. This read-only SQL simulates the existing Ops associate JWT/role,
queries the same `warehouse.procurement_po_handoff` view used by
`SupabaseRepository.getReceivableProcurementPOs` (line 625), and reports actual
`receive_stock` capability plus both normalized handoffs. Require capability true,
two issued POs and the exact variant quantities before declaring Ops-ready. This is
not browser/login certification. No grants or identity mutations are authorized.

## Preservation and Verification

One transaction, bounded table locks, five-second lock timeout and 30-second statement
timeout. Exact ID ownership and natural-key conflicts abort; reruns never overwrite
tester changes. Existing replenishment links abort to prevent the installed PO insert
trigger from updating unrelated recommendations. Verification asserts goods-request
linkage and JSON/normalized PO line identity, quantity, UOM and price coherence.
Existing receipt quantities and lifecycle state are not reset. A coherence error is
reported for review, not repaired. Fresh stock must enter through normal receiving/QC.

Read-only UAT schema inspection on Sep8 confirmed suppliers contain only id, name,
lead_time_days; normalized PO lines have warehouse_product_id and receiving_status
(`open`, `rejected`, `cancelled`). PGlite uses source base tables and these scoped live
columns/checks, not a claim to replay every installed production trigger.

Receiving source: `20260826015244_governed_po_receipt_breakdown.sql:151` requires
issued PO; line 165 requires its exact open normalized line. The installed
`private.assert_goods_procurement_po(text)` requires a linked goods request and
approved/issued PO; the inner breakdown guard is stricter (issued).
`modules/warehouse/src/domain/workQueues.ts:12` also requires issued for inbound work.

Inputs remaining: main's live rollback/approval of rendered SQL; confirm the synthetic
cost placeholders if different values are desired before first application. Main's
reported live preflight found no Sep7 PO collisions; SQL rechecks exact keys under lock.
