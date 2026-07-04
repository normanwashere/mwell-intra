-- Mwell Intra — core.activity_log (cross-module audit ledger, spec §4.6)
--
-- The append-only cross-module trail for approvals, document status changes,
-- vendor lifecycle, RBAC assignments, etc. It generalizes the warehouse
-- `movements` ledger idea (docs/LLD.md §4.2); warehouse keeps its own
-- append-only `movements` for stock math, while this is the suite-wide trail.
--
-- ALSO the RA 10173 (PH Data Privacy Act) ACCESS LOG (spec §9): reads/writes of
-- personal & commercial data (vendor/employee documents) are recorded here.
-- `actor` is always forced to auth.uid() by the write RPCs (no client forgery).
-- The table is APPEND-ONLY: no UPDATE/DELETE policies are ever created.
--
-- Re-runnable: create table if not exists + guarded FK.

create table if not exists core.activity_log (
  id          bigserial primary key,
  module      text not null,        -- 'core'|'warehouse'|'procurement'|'legal'
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null,        -- 'created'|'updated'|'status_changed'|'approved'|'rejected'|...
  actor       uuid,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists activity_log_entity_idx on core.activity_log (entity_type, entity_id);
create index if not exists activity_log_module_idx on core.activity_log (module, created_at);
create index if not exists activity_log_actor_idx on core.activity_log (actor);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activity_log_actor_fk') then
    alter table core.activity_log
      add constraint activity_log_actor_fk foreign key (actor)
      references core.profiles(id) on delete set null;
  end if;
end $$;

alter table core.activity_log enable row level security;

grant select on core.activity_log to authenticated;
grant all on core.activity_log to service_role;
grant usage, select on sequence core.activity_log_id_seq to service_role;
