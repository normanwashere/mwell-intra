# Sep8 Verification and Tester Capacity

Prepared for UAT `kkoitlvydytdhlpxhuah` only. Main executes reviewed SQL; this agent
performed schema/state SELECTs only. Renderer defaults to ROLLBACK. `--apply` renders
COMMIT but never connects. Independently verify the executor's selected project.

## Exact Scope

| Group | Jacket PO | S / M / L ordered | Tumbler PO | Tumblers ordered |
| --- | --- | --- | --- | --- |
| VERIFY | UAT-SEP08-VERIFY-PO-0005 | 20 / 20 / 20 | UAT-SEP08-VERIFY-PO-0006 | 1000 |
| TESTER1 | UAT-SEP08-TESTER1-PO-0005 | 100 / 100 / 100 | UAT-SEP08-TESTER1-PO-0006 | 300 |
| TESTER2 | UAT-SEP08-TESTER2-PO-0005 | 100 / 100 / 100 | UAT-SEP08-TESTER2-PO-0006 | 300 |

Company D supplies jackets; Company E supplies tumblers. Existing vendor identities
are asserted, never updated or inserted. Each group gets four separate products and
barcodes, two draft goods requests, two synthetically issued POs and four normalized
PO lines. No actual human approval is asserted; no identities, signatures, approvals,
policy exceptions, role grants, learning progress, receipts or balances are seeded.
Prices remain explicitly synthetic: jacket PHP500, tumbler PHP150. Expected date
2026-09-08 is a synthetic date, not delivery confirmation. Original Sep7 files unchanged.

## Browser Transaction Binding

Main/Schrodinger agreed final transaction scope: **tumbler VERIFY only**.

- PO: `UAT-SEP08-VERIFY-PO-0006`.
- Line: `UAT-SEP08-VERIFY-PO-0006-LINE-1`.
- Product: `uat-sep08-verify-tumbler`.
- SKU: `UAT-SEP08-VERIFY-TUMBLER`.
- Product barcode: `MWUAT-SEP08-VERIFY-TUMBLER`; no per-unit serial numbers.
- Receive 1000, independently QC-accept 1000, put away 1000, release 10, retain 990.
- Receive into GENERAL AREA (bin unset) to exercise the actual putaway UI, not directly
  into a named bin. Source: StorageAreasPage filters putaway stock with no bin.
- Warehouse: `uat-aug24-pasig-main`, active warehouse verified read-only.
- New destination: `uat-sep08-verify-storage`, code `S8V-STOCK`, label
  `Sep8 verification putaway and release only`.
- No staging/quarantine bin is seeded. No event or packaging stock is seeded.
- Live storage_areas schema has no capacity/category limit columns; only
  id/location_id/code/label/zone/active. Do not invent a limit or reduce the example.
- Marketing department `marketing`, cost center `CC-4100`, both active in live lookup.
  Marketing profile `ed569969-b1dc-4fa6-9135-3f98e68d533c`; OA
  `c9933d59-6993-4d2f-b8c3-824aa9186f14`; OL
  `60bdca8a-14dd-4297-b9a8-be64e9e7a1cc`. These are existing synthetic accounts,
  not a claim that their capabilities/approval eligibility passed. Browser must verify
  normal independent request approval, QC and pack/release roles without bypass.

Do not consume VERIFY jackets, either TESTER batch, or original Sep7 fixtures.
Persistence proof must link real receipt, inspection, putaway, request, fulfillment
and release IDs and reconcile 1000 received/accepted/putaway, 10 released, 990 retained.
Screenshots alone are insufficient. No completion is asserted by these preparation files.

## Safety and Commands

Exact row ownership, natural-key and PO line-slot collision guards fail closed. Existing
replenishment links abort before PO triggers run. Before/after fingerprints over all
non-target rows in the five written tables abort if a trigger changes existing rows.
Reruns use INSERT ON CONFLICT DO NOTHING, preserving tester state; inconsistent JSON
and normalized line identities/quantities/price/UOM abort instead of repairing records.
One transaction, five-second lock timeout, 30-second statement timeout. No schema DDL.

```powershell
node --test scripts/qa/uat-sep08-merch.pglite.test.mjs
$env:SUPABASE_PROJECT_REF='kkoitlvydytdhlpxhuah'
node scripts/qa/render-uat-sep08-merch-sql.mjs --out <new-rehearsal-path.sql>
node scripts/qa/render-uat-sep08-merch-sql.mjs --apply --out <new-apply-path.sql>
```

Existing generated artifacts: `uat-sep08-merch.rehearse.sql` and
`uat-sep08-merch.apply.sql`. Rendering refuses to overwrite paths. PGlite exercises
actual generated SQL with source base schemas/scoped installed column contracts,
not every installed live trigger. Main's live rollback rehearsal is recorded below.

Read-only baseline during preparation: original Sep7 POs issued; four original lines
received_quantity=0; no Sep8 PO references, products' stock/inventory, or new bin codes.
Main must save fresh before/after fingerprints and post-apply Ops handoff readback.

## Execution Receipt: September 8

Main reported successful execution against UAT `kkoitlvydytdhlpxhuah` after Maxwell's
independent review cleared the exact artifacts. Main executed the saved rollback SQL,
confirmed zero new rows afterward, and successfully applied the corresponding COMMIT
artifact. Main reported the apply differed only in its transaction terminator.
This is an attributed execution report, not a second live verification by this agent.

Frozen SHA256 values:

| Artifact | SHA256 |
| --- | --- |
| uat-sep08-merch.rehearse.sql | `1bd1b6286b50e673ed254e88c686e2e10e890b9340ee261b49546d924497f53c` |
| uat-sep08-merch.apply.sql | `320c8a3eb20301648ba419ec6f206c58a05722e175b6d8bbbdf4d70fe6aa4d46` |
| uat-sep08-merch-fixtures.mjs | `3719305e7b41d49fef8383ff77c13e68efcf27788af4fac56b24c4f9835702b2` |
| render-uat-sep08-merch-sql.mjs | `2b3b22b8735d211722b936fe087446c927c649fff4065f201b645efae051ad27` |

Local verification: 12/12 tests passed, zero skips; Maxwell independently reported
12/12 passing and exact renderer/artifact byte matching. Seed sources and SQL have
not changed after that review. The preparation manifest retains its original
`prepared_not_applied_by_author` status; this receipt records main's later execution.

Browser agent was notified by main. Actual receiving/QC/putaway/release execution,
linked persisted IDs, 1000/10/990 reconciliation, protected tester readback and final
independent transaction review remain pending here. The five-table seed fingerprint
guard is not blanket proof of every table or later browser action. No further live
calls or seed changes were performed by this agent for this receipt.
