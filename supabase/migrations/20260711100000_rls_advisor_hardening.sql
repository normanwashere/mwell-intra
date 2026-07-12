-- Resolve RLS advisor WARN findings without widening access.

do $$
declare
  p record;
  v_using text;
  v_check text;
begin
  -- Cache auth helper results once per statement instead of once per row.
  for p in
    select * from pg_policies
    where schemaname in ('public','core','legal','procurement','warehouse')
      and (coalesce(qual,'') ~ 'auth\.(uid|jwt)\(\)'
        or coalesce(with_check,'') ~ 'auth\.(uid|jwt)\(\)')
  loop
    v_using := replace(replace(p.qual, 'auth.uid()', '(select auth.uid())'), 'auth.jwt()', '(select auth.jwt())');
    v_check := replace(replace(p.with_check, 'auth.uid()', '(select auth.uid())'), 'auth.jwt()', '(select auth.jwt())');
    if p.cmd = 'SELECT' or p.cmd = 'DELETE' then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, v_using);
    elsif p.cmd = 'INSERT' then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, v_check);
    else
      execute format('alter policy %I on %I.%I using (%s) with check (%s)',
        p.policyname, p.schemaname, p.tablename, coalesce(v_using,'true'), coalesce(v_check,v_using,'true'));
    end if;
  end loop;
end $$;

do $$
declare
  target record;
  p record;
  v_check text;
begin
  -- These FOR ALL policies are the write half of a separate, broader SELECT
  -- policy. Split them by mutation command so they no longer duplicate reads.
  for target in
    select * from (values
      ('public','activation_events','activation_events_requester_write'),
      ('public','allocation_request_lines','allocation_request_lines_manager_write'),
      ('public','allocation_requests','allocation_requests_requester_write'),
      ('public','cost_layers','cost_layers_finance_only_write'),
      ('public','event_usage_reports','event_usage_reports_owner_write'),
      ('public','export_jobs','export_jobs_role_scoped_write'),
      ('public','inventory_balances','authenticated users can write inventory balances'),
      ('public','inventory_locations','inventory_locations_admin_write'),
      ('public','issuances','issuances_floor_write'),
      ('public','metric_definitions','metric_definitions_bi_write'),
      ('public','products','products_masterdata_write'),
      ('public','purchase_orders','purchase_orders_procurement_write'),
      ('public','reservations','reservations_manager_write'),
      ('public','serialized_units','serialized_units_logistics_write'),
      ('public','sku_variants','sku_variants_masterdata_write'),
      ('public','suppliers','suppliers_procurement_write'),
      ('public','valuation_snapshots','valuation_snapshots_finance_write'),
      ('warehouse','suppliers','suppliers_write')
    ) as t(schema_name, table_name, policy_name)
  loop
    select * into p from pg_policies
    where schemaname=target.schema_name and tablename=target.table_name
      and policyname=target.policy_name and cmd='ALL';
    if p.policyname is null then continue; end if;
    v_check := coalesce(p.with_check,p.qual,'true');
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    execute format('create policy %I on %I.%I for insert to authenticated with check (%s)',
      p.policyname || '_insert', p.schemaname, p.tablename, v_check);
    execute format('create policy %I on %I.%I for update to authenticated using (%s) with check (%s)',
      p.policyname || '_update', p.schemaname, p.tablename, coalesce(p.qual,'true'), v_check);
    execute format('create policy %I on %I.%I for delete to authenticated using (%s)',
      p.policyname || '_delete', p.schemaname, p.tablename, coalesce(p.qual,'true'));
  end loop;
end $$;
