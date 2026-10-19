import { readFileSync } from "node:fs";

const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const verifierMigration = migration("20260905050907_quality_inspection_verifier_chain.sql");
export const externalVerifierMigration = migration("20261019143020_external_po_quality_verifier_chain.sql");
export function functionDefinition(sql, name) {
  const start = ["create or replace function", "create function"]
    .map(prefix => sql.indexOf(`${prefix} ${name}(`)).find(index => index >= 0) ?? -1;
  if (start < 0) throw new Error(`Missing actual definition: ${name}`);
  return sql.slice(start, sql.indexOf("$$;", start) + 3);
}

export async function installExternalQualityChain(db) {
  await db.exec("set check_function_bodies=off");
  const sql = migration("20261019142956_warehouse_external_po_receiving.sql");
  for (const [, name] of sql.matchAll(/^create (?:or replace )?function ([\w.]+)\(/gm)) {
    await db.exec(functionDefinition(sql, name));
  }
  await db.exec("create table if not exists warehouse.inventory_holds(id uuid primary key)");
  await db.exec(sql.match(/^create trigger guard_external_po_hold .*;$/m)[0]);
  await db.exec(sql.slice(sql.indexOf("revoke all on function private.external_po_can_read()")));
}

export async function installLatestLaunchVerifier(db) {
  // The vendor lookup is unrelated to Quality; preserve its outer RPC and output.
  await db.exec(`create function private.legal_tailored_requirement_set(jsonb)
    returns table(code text,title text) language sql as $$ select 'fixture-requirement'::text,'Fixture'::text $$`);
  const sql = migration("20260914053733_uat_vendor_fixture_atomic_cleanup.sql");
  await db.exec(sql.slice(0, sql.indexOf("-- No API/table grant:")));
}

// Catalog-only fixture: install actual bodies without executing business RPCs.
// Deferred body validation avoids inventing stub implementations for the chain.
export async function installActualQualityChain(db) {
  await db.exec("set check_function_bodies=off");
  await db.exec(functionDefinition(migration("20260717143000_task3_receipt_authority_forward_convergence.sql"), "private.warehouse_inspect_quality_v2"));
  for (const file of ["20260816230000_repair_quality_acceptance_and_doa_activation.sql", "20260816231000_enforce_quality_receipt_line_identity_precedence.sql"]) {
    const sql = migration(file);
    await db.exec(sql.slice(sql.indexOf("do $migration$"), sql.indexOf("$migration$;") + "$migration$;".length));
  }
  const custody = migration("20260826032845_converge_receipt_quality_custody.sql");
  await db.exec(functionDefinition(custody, "private.warehouse_inspect_quality_v3"));
  await db.exec(functionDefinition(custody, "warehouse.inspect_quality"));
  const returns = migration("20260828033036_return_intake_atomic_quarantine.sql");
  await db.exec(functionDefinition(returns, "private.inspect_return_intake"));
  const dispatch = returns.indexOf("do $$", returns.indexOf("-- Guard against silently overwriting"));
  await db.exec(returns.slice(dispatch, returns.indexOf("$$;", dispatch) + 3));
  await db.exec(`revoke all on function private.warehouse_inspect_quality_v2(jsonb), private.warehouse_inspect_quality_v3(jsonb), private.inspect_return_intake(jsonb) from public,anon,authenticated;
    revoke all on function warehouse.inspect_quality(jsonb) from public,anon;
    grant execute on function warehouse.inspect_quality(jsonb) to authenticated,service_role;
    grant execute on function private.warehouse_inspect_quality_v2(jsonb),private.warehouse_inspect_quality_v3(jsonb) to service_role;`);
}

export async function installPriorReadVerifier(db) {
  await db.exec("set check_function_bodies=off");
  await db.exec(functionDefinition(migration("20260816221000_certify_commitment_readiness_boundary.sql"), "procurement.commitment_readiness"));
  await db.exec(functionDefinition(migration("20260816183000_reconcile_launch_authority_and_learning.sql"), "procurement.purchase_order_receipt_status"));
  await db.exec(functionDefinition(migration("20260816231000_enforce_quality_receipt_line_identity_precedence.sql"), "core.verify_launch_read_contracts"));
  await db.exec(functionDefinition(migration("20260816230000_repair_quality_acceptance_and_doa_activation.sql"), "procurement.activate_doa_matrix"));
  await db.exec(migration("20260816210000_add_service_role_launch_verifier.sql"));
  await db.exec("grant execute on function procurement.commitment_readiness(jsonb),procurement.purchase_order_receipt_status(jsonb) to authenticated");
}
