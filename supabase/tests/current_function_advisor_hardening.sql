-- Production-safe assertions for the current-function advisor hardening.
do $$
declare
  missing_fk_indexes integer;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'warehouse.stock_levels'::regclass
      and conname = 'stock_levels_pkey'
      and contype = 'p'
  ) then
    raise exception 'warehouse.stock_levels primary key is missing';
  end if;

  if exists (select 1 from warehouse.stock_levels where id is null) then
    raise exception 'warehouse.stock_levels contains a null identity';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'warehouse'
      and tablename = 'stock_levels'
      and indexdef ilike '%(product_id, location_id, bin_id, lot_id)%'
  ) then
    raise exception 'warehouse.stock_levels business-key index is missing';
  end if;

  with fk as (
    select con.conrelid, con.conkey
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f'
      and n.nspname in ('core','legal','procurement','public','warehouse')
  )
  select count(*) into missing_fk_indexes
  from fk
  where not exists (
    select 1 from pg_index i
    where i.indrelid = fk.conrelid
      and i.indisvalid
      and (i.indkey::smallint[])[0:cardinality(fk.conkey)-1] = fk.conkey
  );

  if missing_fk_indexes <> 0 then
    raise exception '% foreign keys remain without a leading index', missing_fk_indexes;
  end if;

  if (
    select count(*) from pg_policies
    where schemaname = 'procurement'
      and tablename = 'purchase_orders'
      and cmd = 'SELECT'
      and 'authenticated' = any(roles)
  ) <> 1 then
    raise exception 'purchase_orders must have one authenticated SELECT policy';
  end if;

  if (
    select count(*) from pg_policies
    where schemaname = 'procurement'
      and tablename = 'purchase_order_lines'
      and cmd = 'SELECT'
      and 'authenticated' = any(roles)
  ) <> 1 then
    raise exception 'purchase_order_lines must have one authenticated SELECT policy';
  end if;

  if exists (
    select 1 from pg_policies
    where (schemaname, tablename, policyname) in (
      ('procurement', 'request_attachments', 'request_attachments_read'),
      ('warehouse', 'export_jobs', 'warehouse_export_jobs_read'),
      ('warehouse', 'stock_change_requests', 'warehouse_stock_changes_read'),
      ('warehouse', 'import_jobs', 'warehouse_import_jobs_read'),
      ('warehouse', 'import_errors', 'warehouse_import_errors_read')
    )
      and coalesce(qual, '') like '%auth.uid()%'
      and coalesce(qual, '') not like '%( SELECT auth.uid() AS uid)%'
  ) then
    raise exception 'one or more user-scoped policies evaluate auth.uid per row';
  end if;
end
$$;

