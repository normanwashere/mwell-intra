-- Keep the Insights projection deliberately read-only for browser roles.
-- Explicitly revoking authenticated privileges prevents PostgREST from
-- attempting to write through the non-updatable view and returning a 500.

revoke all privileges on table core.v_insights_snapshot
  from public, anon, authenticated;

grant select on table core.v_insights_snapshot
  to authenticated, service_role;

create or replace function core.reject_insights_snapshot_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise insufficient_privilege
    using message = 'Insights snapshot is read-only.';
end;
$$;

revoke all on function core.reject_insights_snapshot_write()
  from public, anon, authenticated;

drop trigger if exists reject_insights_snapshot_write
  on core.v_insights_snapshot;

create trigger reject_insights_snapshot_write
instead of insert or update or delete on core.v_insights_snapshot
for each row execute function core.reject_insights_snapshot_write();
