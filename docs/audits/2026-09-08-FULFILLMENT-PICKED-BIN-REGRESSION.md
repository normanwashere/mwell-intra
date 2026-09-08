# Fulfillment Picked-Bin Regression

## Confirmed Installed Risk

On 2026-09-08 a read-only `pg_get_functiondef` query against UAT project `kkoitlvydytdhlpxhuah` retrieved the installed public `warehouse.advance_fulfillment_order` and private base/v2/v3 functions. The public function calls v3, which calls v2, which calls the base. No live mutations were performed.

Exact returned definitions are preserved in `scripts/fixtures/sep08-installed-fulfillment.sql`, SHA256 `7AC833E6839F52C854109EAAC82F23F19568CDA44EAE16E3179A75B83794F981`. This is a dated installed snapshot, not an assertion that historical migrations remain current indefinitely.

V3 validates the scanned bin and records line `pickBinId`. The installed base bulk-release branch ignores that field and selects stock using nullable order-level source location/bin, ordered by location/bin/lot. Departmental demand can have null order-level source fields.

## Executed Reproduction

`scripts/verify-fulfillment-picked-bin.pglite.test.mjs` executes all four installed functions in PGlite, with a minimal schema and local identity/capability/idempotency adapters. It starts an existing departmental order in picking, confirms three nonserialized merchandise units from B, confirms internal handover with a packing actor, then releases with a distinct actor. Both A and B initially contain ten units of the same product.

- Installed snapshot: **1 pass, 2 fail**, exit 1. Actual A=7/B=10; expected A=10/B=7. The order correctly recorded `pickBinId=B` before release.
- Installed snapshot with B fully held after packing: release incorrectly succeeds using A instead of rejecting unavailable picked stock.
- Local proposal: **3 pass**, exit 0. Release debits B and records B in the movement; replay adds no movement. A full B hold rejects without movement or status advancement. Same packer and denied capability reject.
- Both runs were repeated with the same outcomes. Logs: `outputs/sep08-picked-bin-regression/installed-red.log` and `local-proposal-green.log`.

## Minimal Proposal

In a NEW forward migration, retain the base function and add the following conjunct only to its nonserialized order-line release stock selection:

```sql
and (nullif(v_line->>'pickBinId', '') is null
     or level.bin_id = v_line->>'pickBinId')
```

Keep existing order source constraints, row locks, per-bin/lot hold subtraction, idempotency, capability checks and the separate pack/release actor requirement. Do not overwrite order-level source fields to implement a per-line selection. The null branch preserves legacy orders without a recorded directed pick; deciding whether those require re-picking is separate policy work.

The initial local proposal above was superseded by the reviewed forward migration `20260908033401_fulfillment_release_exact_picked_bin.sql`. It also requires a recorded bin to remain active and in the stock row's warehouse. Default regression execution now loads the actual migration after the immutable installed snapshot. Thirteen tests passed in both author and independent runs. Baseline mode retains the original two failures; it is not a passing certification run.

Commands (bundled Node24 directory first in PATH):

```powershell
node --test scripts/verify-fulfillment-picked-bin.pglite.test.mjs
$env:FULFILLMENT_BIN_BASELINE='1'
node --test scripts/verify-fulfillment-picked-bin.pglite.test.mjs
```

## Limits

The forward migration was applied to UAT `kkoitlvydytdhlpxhuah` on September 8 after independent approval; an installed-function query confirmed the exact picked-bin predicate. Production was untouched. Migration SHA256: `DCA6D99DCD0795E1E71AC0181B0A465416955A3C731C1E3969AC64E301759863`.

Local tests use auth/capability adapters and are not deployed RLS or concurrent-session certification. Live receipt-to-release acceptance is recorded separately with persisted stock and movement evidence. This narrow change does not redefine legacy missing-bin policy or certify unrelated serialized/packaging workflows.
