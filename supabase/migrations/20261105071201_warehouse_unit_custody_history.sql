-- Record custody changes from actual unit rows, never by guessing from product totals.
-- No historical aggregate movement is backfilled as a unit-specific event.
create table private.warehouse_unit_history (
  id bigint generated always as identity primary key,
  unit_id text not null,
  product_id text not null,
  serial_number text not null,
  operation text not null check(operation in ('registered','changed','removed')),
  before_state jsonb,
  after_state jsonb,
  actor_id uuid,
  recorded_at timestamptz not null default clock_timestamp()
);
create index warehouse_unit_history_unit_page on private.warehouse_unit_history(unit_id,id desc);
alter table private.warehouse_unit_history enable row level security;
revoke all on private.warehouse_unit_history from public,anon,authenticated;
revoke all on sequence private.warehouse_unit_history_id_seq from public,anon,authenticated;

create or replace function private.warehouse_record_unit_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_before jsonb; v_after jsonb; v_row jsonb;
begin
  if tg_op<>'INSERT' then v_before:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_after:=to_jsonb(new); end if;
  if v_before is not distinct from v_after then return new; end if;
  v_row:=coalesce(v_after,v_before);
  insert into private.warehouse_unit_history(unit_id,product_id,serial_number,operation,before_state,after_state,actor_id)
    values(v_row->>'id',v_row->>'product_id',v_row->>'serial_number',
      case tg_op when 'INSERT' then 'registered' when 'DELETE' then 'removed' else 'changed' end,
      v_before,v_after,auth.uid());
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger warehouse_unit_history after insert or update or delete on warehouse.inventory_units
  for each row execute function private.warehouse_record_unit_history();
revoke all on function private.warehouse_record_unit_history() from public,anon,authenticated;

create or replace function warehouse.unit_custody_history(p_unit_id text,p_before_id bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not private.can_read_warehouse_table('inventory_units') then
    raise exception 'You do not have access to Warehouse unit history.';
  end if;
  if nullif(btrim(p_unit_id),'') is null then raise exception 'Choose a unit to view its history.'; end if;
  select coalesce(jsonb_agg(to_jsonb(page) order by id::bigint desc),'[]'::jsonb) into v_rows from (
    select id::text as id,unit_id,product_id,serial_number,operation,
      before_state - 'assigned_to' as before_state,after_state - 'assigned_to' as after_state,recorded_at
    from private.warehouse_unit_history where unit_id=p_unit_id and (p_before_id is null or id<p_before_id)
    order by private.warehouse_unit_history.id desc limit 51
  ) page;
  return v_rows;
end $$;
revoke all on function warehouse.unit_custody_history(text,bigint) from public,anon;
grant execute on function warehouse.unit_custody_history(text,bigint) to authenticated,service_role;
select pg_notify('pgrst','reload schema');
