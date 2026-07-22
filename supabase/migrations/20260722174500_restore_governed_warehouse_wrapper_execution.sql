-- Public RPC wrappers must execute their private SECURITY DEFINER
-- implementations without exposing the private schema to API roles.

create or replace function warehouse.release_quality_hold(payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.warehouse_release_quality_hold(payload) $$;

create or replace function warehouse.submit_cycle_count(payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.warehouse_submit_cycle_count(payload) $$;

revoke all on function private.warehouse_release_quality_hold(jsonb)
  from public, anon, authenticated;
revoke all on function private.warehouse_submit_cycle_count(jsonb)
  from public, anon, authenticated;
revoke all on function warehouse.release_quality_hold(jsonb)
  from public, anon;
revoke all on function warehouse.submit_cycle_count(jsonb)
  from public, anon;
grant execute on function warehouse.release_quality_hold(jsonb)
  to authenticated, service_role;
grant execute on function warehouse.submit_cycle_count(jsonb)
  to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
