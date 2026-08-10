import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260810155237_block_transfer_of_held_inventory.sql",
  import.meta.url,
);

test("warehouse transfers cannot move inventory covered by an active hold", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /create or replace function private\.warehouse_transfer\(payload jsonb\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
  );
  assert.match(
    migration,
    /core\.has_cap\('warehouse',\s*'transfer_stock'\)/i,
  );
  assert.match(migration, /private\.lock_warehouse_products\(v_product_ids\)/i);
  assert.match(
    migration,
    /from warehouse\.inventory_units[\s\S]*?for update/i,
    "serialized source units must be locked before hold validation",
  );
  assert.match(
    migration,
    /active_hold\.product_id\s*=\s*v_unit\.product_id[\s\S]*?active_hold\.location_id\s*=\s*v_unit\.location_id[\s\S]*?active_hold\.bin_id is not distinct from v_unit\.bin_id[\s\S]*?active_hold\.lot_id is not distinct from v_unit\.lot_id[\s\S]*?active_hold\.serial_number\s*=\s*v_unit\.serial_number/i,
    "serialized holds must match the persisted unit identity exactly",
  );
  assert.match(migration, /Held serialized inventory cannot be transferred/i);
});

test("bulk transfers preserve lot identity and subtract exact active holds", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /from warehouse\.stock_levels[\s\S]*?for update/i,
    "the exact bulk source row must be locked",
  );
  assert.match(
    migration,
    /count\(\*\)[\s\S]*?Ambiguous source inventory; lot_id is required/i,
    "legacy payloads may infer one lot but must reject ambiguous sources",
  );
  assert.match(
    migration,
    /active_hold\.product_id\s*=\s*v_product_id[\s\S]*?active_hold\.location_id\s*=\s*v_from_location_id[\s\S]*?active_hold\.bin_id is not distinct from v_from_bin_id[\s\S]*?active_hold\.lot_id is not distinct from v_lot_id[\s\S]*?active_hold\.serial_number is null/i,
    "bulk holds must use the exact product/location/bin/lot identity",
  );
  assert.match(
    migration,
    /v_source_quantity\s*-\s*v_held_quantity\s*<\s*v_from_quantity/i,
  );
  assert.match(migration, /Inventory covered by an active hold cannot be transferred/i);
  assert.match(
    migration,
    /insert into warehouse\.stock_levels\s*\(product_id, location_id, bin_id, lot_id, quantity\)[\s\S]*?v_lot_id/i,
    "the destination row must retain the source lot",
  );
});

test("the exposed transfer RPC remains an authorized invoker wrapper", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /create or replace function warehouse\.transfer\(payload jsonb\)[\s\S]*?language sql[\s\S]*?security invoker[\s\S]*?set search_path = ''[\s\S]*?private\.warehouse_transfer\(payload\)/i,
  );
  assert.match(
    migration,
    /revoke all on function private\.warehouse_transfer\(jsonb\) from public, anon/i,
  );
  assert.match(
    migration,
    /grant execute on function private\.warehouse_transfer\(jsonb\) to authenticated, service_role/i,
  );
  assert.match(
    migration,
    /grant execute on function warehouse\.transfer\(jsonb\) to authenticated, service_role/i,
  );
  assert.match(migration, /pg_notify\('pgrst',\s*'reload schema'\)/i);
});
