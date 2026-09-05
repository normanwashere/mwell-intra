import { readFileSync } from "node:fs";

const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
export const verifierMigration = migration("20260905050907_quality_inspection_verifier_chain.sql");
export function functionDefinition(sql, name) {
  const start = sql.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error(`Missing actual definition: ${name}`);
  return sql.slice(start, sql.indexOf("$$;", start) + 3);
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
