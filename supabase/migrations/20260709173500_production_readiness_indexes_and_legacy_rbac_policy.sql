-- Production-readiness hardening from the full Intra audit.
--
-- 1. Make the retired warehouse-local RBAC catalogue explicit under RLS.
--    The app uses core.role_capabilities through core.has_cap(); this legacy
--    table should not be client-readable.
-- 2. Add missing indexes on active-schema foreign-key columns to keep joins,
--    deletes, and policy checks predictable as live volume grows.

do $$
begin
  if to_regclass('warehouse.role_capabilities') is not null then
    alter table warehouse.role_capabilities enable row level security;
    revoke all on warehouse.role_capabilities from anon, authenticated;

    drop policy if exists warehouse_legacy_role_capabilities_no_client_access
      on warehouse.role_capabilities;

    create policy warehouse_legacy_role_capabilities_no_client_access
      on warehouse.role_capabilities
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;

create index if not exists activity_log_actor_fk_idx
  on core.activity_log(actor);

create index if not exists approvals_decided_by_fk_idx
  on core.approvals(decided_by);

create index if not exists documents_uploaded_by_fk_idx
  on core.documents(uploaded_by);

create index if not exists role_capabilities_module_cap_fk_idx
  on core.role_capabilities(module, cap);

create index if not exists user_roles_module_role_fk_idx
  on core.user_roles(module, role);

create index if not exists accreditation_docs_requirement_fk_idx
  on legal.accreditation_docs(requirement_id);

create index if not exists accreditation_docs_vendor_fk_idx
  on legal.accreditation_docs(vendor_id);

create index if not exists signed_instruments_case_fk_idx
  on legal.signed_instruments(case_id);

create index if not exists vendor_invites_case_fk_idx
  on legal.vendor_invites(case_id);

create index if not exists vendor_invites_vendor_fk_idx
  on legal.vendor_invites(vendor_id);

create index if not exists purchase_orders_actor_fk_idx
  on procurement.purchase_orders(actor_id);

create index if not exists purchase_orders_core_vendor_fk_idx
  on procurement.purchase_orders(core_vendor_id);

create index if not exists requests_core_vendor_fk_idx
  on procurement.requests(core_vendor_id);

create index if not exists cycle_counts_bin_fk_idx
  on warehouse.cycle_counts(bin_id);

create index if not exists inventory_units_bin_fk_idx
  on warehouse.inventory_units(bin_id);

create index if not exists stock_levels_bin_fk_idx
  on warehouse.stock_levels(bin_id);
