import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260713190000_governed_rpc_wrapper_execution.sql",
  ),
  "utf8",
);

const governedWrappers = [
  "legal.submit_vendor_application",
  "legal.record_instrument_signature",
  "legal.sign_instrument",
  "procurement.confirm_route_decision",
  "procurement.submit_request",
  "procurement.approve_purchase_order",
  "procurement.issue_purchase_order",
  "procurement.record_acceptance_pack",
  "procurement.prepare_payment_readiness",
  "procurement.review_payment_readiness",
  "procurement.save_doa_matrix",
  "procurement.activate_doa_matrix",
];

describe("governed RPC execution boundary", () => {
  it.each(governedWrappers)(
    "executes %s through a protected owner wrapper",
    (wrapper) => {
      expect(migration).toContain(
        `alter function ${wrapper}(jsonb) security definer;`,
      );
      expect(migration).toContain(
        `alter function ${wrapper}(jsonb) set search_path = '';`,
      );
      expect(migration).toContain(
        `revoke all on function ${wrapper}(jsonb) from public, anon;`,
      );
      expect(migration).toContain(
        `grant execute on function ${wrapper}(jsonb) to authenticated, service_role;`,
      );
    },
  );
});
