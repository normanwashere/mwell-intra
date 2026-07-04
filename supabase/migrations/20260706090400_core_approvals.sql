-- Mwell Intra — core.approvals (generic multi-step approvals engine, spec §4.5)
--
-- A generic approval-step ledger reused across modules (procurement requests,
-- accreditation cases, purchase orders). A row is one step: the role expected to
-- act, the decision, who decided, and an SLA due timestamp (scheduled jobs email
-- approvers on sla_due_at — spec §8). Decisions are recorded through
-- core.record_approval_decision() (RPC migration); this table only stores state.
--
-- Re-runnable: create table if not exists + guarded FK.

create table if not exists core.approvals (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,   -- 'procurement_request'|'accreditation'|'purchase_order'
  entity_id     uuid not null,
  step          int  not null,
  approver_role text not null,   -- module role expected to act
  decision      text not null default 'pending', -- 'pending'|'approved'|'rejected'
  decided_by    uuid,
  decided_at    timestamptz,
  note          text,
  sla_due_at    timestamptz
);

create index if not exists approvals_entity_idx on core.approvals (entity_type, entity_id);
create index if not exists approvals_pending_idx on core.approvals (decision) where decision = 'pending';
create index if not exists approvals_sla_idx on core.approvals (sla_due_at);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'approvals_decider_fk') then
    alter table core.approvals
      add constraint approvals_decider_fk foreign key (decided_by)
      references core.profiles(id) on delete set null;
  end if;
end $$;

alter table core.approvals enable row level security;

grant select on core.approvals to authenticated;
grant all on core.approvals to service_role;
