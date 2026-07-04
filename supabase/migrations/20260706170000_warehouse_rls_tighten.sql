-- Mwell Intra — warehouse read-model RLS tightening (v_read_scope_v1)
--
-- The base warehouse RLS (20260706092200_warehouse_rls.sql) opened the general
-- read-model to `using(true)` for any authenticated session (rationale in that
-- file: "dashboards / analytics span roles"). Post-Step-3, the same Supabase
-- project also hosts procurement- and legal-only tiers whose users legitimately
-- authenticate but MUST NOT be granted a blanket read over warehouse inventory:
--   * legal:vendor    — external tier, warehouse data is out of scope
--   * procurement/legal-only staff without any warehouse role
--
-- This migration scopes those SELECT policies to callers who hold ANY warehouse
-- role. Because every warehouse role (docs/LLD.md §9, mirrored in
-- 20260706091000_core_seed_rbac.sql) grants `warehouse.view_dashboard`,
-- gating on that cap is functionally equivalent to "user has a warehouse role";
-- a `has_module_role('warehouse')` helper is added as a belt-and-suspenders
-- fallback (in case a future role grant omits view_dashboard).
--
-- Preserved AS-IS (already capability-scoped in the base RLS migration):
--   * warehouse.suppliers        — has_any_cap(view_procurement|receive_stock|manage_products)
--   * warehouse.purchase_orders  — has_any_cap(view_procurement|receive_stock)
--   * warehouse.lots             — has_any_cap(view_procurement|view_finance|view_pricing|receive_stock)
--   * warehouse.profiles         — self by email
--
-- Write policies, RPC-only lockdown, and anon revocation from the base RLS
-- migration are untouched.
--
-- Re-runnable: drop policy if exists before create; create or replace helper.

-- ---------------------------------------------------------------------------
-- Helper: does auth.uid() hold ANY role for the given module?
-- SECURITY DEFINER so we can consult the locked-down core catalogue
-- (core.user_roles is exposed for self, but explicit definer keeps this
-- consistent with core.has_cap / core.has_any_cap).
-- ---------------------------------------------------------------------------
create or replace function core.has_module_role(p_module text)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1 from core.user_roles ur
    where ur.user_id = auth.uid()
      and ur.module = p_module
  );
$$;

revoke all on function core.has_module_role(text) from public, anon;
grant execute on function core.has_module_role(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tighten the general warehouse read-model.
--
-- Same table list as the base migration's `using(true)` loop; excludes the
-- capability-scoped `suppliers`, `purchase_orders`, `lots` and the self-only
-- `profiles`, all of which stay on their existing gates.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'locations','products','events','storage_areas',
    'inventory_units','stock_levels','allocations','movements','receipts',
    'returns','cycle_counts'
  ]
  loop
    execute format('drop policy if exists read_authenticated on warehouse.%I;', t);
    execute format($f$
      create policy read_authenticated on warehouse.%I
        for select to authenticated
        using (
          core.has_cap('warehouse','view_dashboard')
          or core.has_module_role('warehouse')
        );
    $f$, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
