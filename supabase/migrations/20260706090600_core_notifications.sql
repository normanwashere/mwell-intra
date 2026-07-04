-- Mwell Intra — core.notifications (spec §4.7)
--
-- Phase 1 ships the TABLE (+ RPC write paths). Delivery (email/push) and the
-- scheduled jobs that populate it at scale are Phase 4 (spec §8): a nightly job
-- flips vendor accreditation to renewal_due/expired and inserts notifications;
-- another emails approvers on approvals.sla_due_at. Recipients read their own
-- rows and mark them read via core.mark_notification_read() (RPC migration).
--
-- Re-runnable: create table if not exists + guarded FK.

create table if not exists core.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  kind        text not null,        -- 'accreditation_expiring'|'approval_pending'|...
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx on core.notifications (user_id, read_at);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_user_fk') then
    alter table core.notifications
      add constraint notifications_user_fk foreign key (user_id)
      references core.profiles(id) on delete cascade;
  end if;
end $$;

alter table core.notifications enable row level security;

grant select on core.notifications to authenticated;
grant all on core.notifications to service_role;
