-- Enforce four attributable Event settlement actors where applicable:
-- Event preparer, Finance settlement approver, Finance poster, and reconciler.
-- This converges forward from the already-applied Event close controls.

do $$
begin
  if exists (
    select 1
    from core.finance_close_entries close_entry
    join warehouse.event_reconciliations reconciliation
      on reconciliation.event_id = close_entry.source_record_id
    where close_entry.source_record_type = 'event_reconciliation'
      and (
        close_entry.posted_by = reconciliation.approved_by
        or close_entry.reconciled_by = reconciliation.approved_by
        or (
          close_entry.status = 'reconciled'
          and close_entry.reconciled_by in (
            close_entry.prepared_by,
            close_entry.posted_by
          )
        )
      )
  ) then
    raise exception 'Existing Event Finance close entries violate actor separation and must be resolved before migration';
  end if;
end;
$$;

create or replace function private.enforce_event_finance_actor_separation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approved_by uuid;
begin
  if new.source_record_type is distinct from 'event_reconciliation' then
    return new;
  end if;

  select reconciliation.approved_by
  into v_approved_by
  from warehouse.event_reconciliations reconciliation
  where reconciliation.event_id = new.source_record_id
    and reconciliation.status = 'approved';

  if not found or v_approved_by is null then
    raise exception 'Approved Event reconciliation actor lineage was not found';
  end if;

  if new.status in ('posted', 'reconciled') then
    if new.posted_by is null then
      raise exception 'Event settlement close entry requires an attributable poster';
    end if;
    if new.posted_by = v_approved_by then
      raise exception 'The Event settlement approver cannot post its generated close entry';
    end if;
    if new.posted_by = new.prepared_by then
      raise exception 'The Event settlement preparer cannot post its generated close entry';
    end if;
  end if;

  if new.status = 'reconciled' then
    if new.reconciled_by is null then
      raise exception 'Event settlement close entry requires an attributable reconciler';
    end if;
    if new.reconciled_by = v_approved_by then
      raise exception 'The Event settlement approver cannot reconcile its generated close entry';
    end if;
    if new.reconciled_by = new.posted_by then
      raise exception 'The Event settlement poster cannot reconcile their own close entry';
    end if;
    if new.reconciled_by = new.prepared_by then
      raise exception 'The Event settlement preparer cannot reconcile their own close entry';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_event_finance_actor_separation
on core.finance_close_entries;
create trigger enforce_event_finance_actor_separation
before insert or update of
  source_record_type,
  source_record_id,
  status,
  prepared_by,
  posted_by,
  reconciled_by
on core.finance_close_entries
for each row
execute function private.enforce_event_finance_actor_separation();

revoke all on function private.enforce_event_finance_actor_separation()
from public, anon, authenticated;
grant execute on function private.enforce_event_finance_actor_separation()
to service_role;

alter function core.manage_finance_close_entry(jsonb)
  rename to manage_finance_close_entry_pre_event_actor_separation;

create or replace function core.manage_finance_close_entry(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := payload->>'action';
  v_entry core.finance_close_entries;
  v_approved_by uuid;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated Finance actor required';
  end if;
  if not core.has_live_cap('warehouse', 'manage_finance_close') then
    raise exception 'Not authorized: warehouse.manage_finance_close';
  end if;

  if v_action <> 'save' then
    select *
    into v_entry
    from core.finance_close_entries close_entry
    where close_entry.id = nullif(payload->>'id', '')::uuid
    for update;
    if not found then
      raise exception 'Finance close entry not found';
    end if;

    if v_entry.source_record_type = 'event_reconciliation'
       and v_action in ('post', 'reconcile') then
      select reconciliation.approved_by
      into v_approved_by
      from warehouse.event_reconciliations reconciliation
      where reconciliation.event_id = v_entry.source_record_id
        and reconciliation.status = 'approved'
      for share;
      if not found or v_approved_by is null then
        raise exception 'Approved Event reconciliation actor lineage was not found';
      end if;
      if auth.uid() = v_approved_by then
        if v_action = 'post' then
          raise exception 'The Event settlement approver cannot post its generated close entry';
        end if;
        raise exception 'The Event settlement approver cannot reconcile its generated close entry';
      end if;
    end if;
  end if;

  v_result := core.manage_finance_close_entry_pre_event_actor_separation(payload);
  if v_entry.source_record_type = 'event_reconciliation' then
    return v_result || jsonb_build_object('settlement_approved_by', v_approved_by);
  end if;
  return v_result;
end;
$$;

revoke all on function
  core.manage_finance_close_entry_pre_event_actor_separation(jsonb)
from public, anon, authenticated;
grant execute on function
  core.manage_finance_close_entry_pre_event_actor_separation(jsonb)
to service_role;

revoke all on function core.manage_finance_close_entry(jsonb)
from public, anon;
grant execute on function core.manage_finance_close_entry(jsonb)
to authenticated, service_role;

create or replace view core.finance_close_entry_authority
with (security_invoker = true) as
select
  lineage.*,
  reconciliation.approved_by as settlement_approved_by
from core.finance_close_entry_lineage lineage
left join warehouse.event_reconciliations reconciliation
  on lineage.source_record_type = 'event_reconciliation'
 and reconciliation.event_id = lineage.source_record_id;

revoke all on core.finance_close_entry_authority from public, anon;
grant select on core.finance_close_entry_authority to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
