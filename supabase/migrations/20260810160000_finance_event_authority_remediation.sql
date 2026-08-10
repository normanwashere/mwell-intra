-- Separate read-only Finance visibility from governed close and settlement
-- mutations. This is forward-only so deployed environments retain history.

insert into core.capabilities(module, cap) values
  ('warehouse', 'manage_finance_close'),
  ('events', 'approve_settlement')
on conflict do nothing;

insert into core.roles(module, role, label, description, is_active) values
  (
    'events',
    'finance_reviewer',
    'Finance Settlement Reviewer',
    'Independently reviews submitted event outcomes and settlement evidence.',
    true
  )
on conflict (module, role) do update set
  label = excluded.label,
  description = excluded.description,
  is_active = true;

insert into core.role_capabilities(module, role, cap) values
  ('warehouse', 'finance', 'manage_finance_close'),
  ('events', 'finance_reviewer', 'view_events'),
  ('events', 'finance_reviewer', 'approve_settlement')
on conflict do nothing;

-- Existing users with the canonical Finance Controller role union receive the
-- narrow Events reviewer role. Read-only Pricing and Events roles are untouched.
insert into core.user_roles(user_id, module, role)
select warehouse_finance.user_id, 'events', 'finance_reviewer'
from core.user_roles warehouse_finance
where warehouse_finance.module = 'warehouse'
  and warehouse_finance.role = 'finance'
  and exists (
    select 1
    from core.user_roles procurement_finance
    where procurement_finance.user_id = warehouse_finance.user_id
      and procurement_finance.module = 'procurement'
      and procurement_finance.role = 'finance'
  )
on conflict do nothing;

alter table core.finance_close_entries
  add column if not exists updated_at timestamptz not null default now();

drop policy if exists event_reconciliations_read
  on warehouse.event_reconciliations;
create policy event_reconciliations_read on warehouse.event_reconciliations
for select to authenticated using (
  core.has_cap('events', 'view_events')
  or core.has_cap('events', 'approve_settlement')
  or core.has_cap('warehouse', 'view_inventory')
  or core.has_cap('warehouse', 'view_finance')
);

create or replace function warehouse.save_event_reconciliation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event warehouse.events;
  v_reconciliation warehouse.event_reconciliations;
  v_action text := payload->>'action';
  v_expected_updated_at timestamptz;
  v_issued integer;
  v_accounted integer;
begin
  if v_action in ('save', 'submit') then
    if not core.has_cap('events', 'manage_events') then
      raise exception 'Not authorized: events.manage_events';
    end if;
  elsif v_action = 'approve' then
    if not core.has_cap('events', 'approve_settlement') then
      raise exception 'Not authorized: events.approve_settlement';
    end if;
  else
    raise exception 'Unsupported reconciliation action';
  end if;

  select * into v_event
  from warehouse.events
  where id = payload->>'event_id'
  for update;
  if not found then raise exception 'Event not found'; end if;

  select * into v_reconciliation
  from warehouse.event_reconciliations
  where event_id = v_event.id
  for update;

  if found and v_reconciliation.status = 'approved' then
    raise exception 'An approved event reconciliation cannot be edited';
  end if;

  if found then
    if nullif(payload->>'expected_updated_at', '') is null then
      raise exception 'Refresh the event reconciliation before updating it';
    end if;
    v_expected_updated_at := (payload->>'expected_updated_at')::timestamptz;
    if v_reconciliation.updated_at is distinct from v_expected_updated_at then
      raise exception 'Event reconciliation changed; refresh and try again';
    end if;
  end if;

  select coalesce(sum(allocation.quantity), 0)::integer into v_issued
  from warehouse.allocations allocation
  where allocation.event_id = v_event.id
    and allocation.status in ('issued', 'returned');

  if v_action in ('save', 'submit') then
    if v_reconciliation.event_id is null then
      insert into warehouse.event_reconciliations(
        event_id, status, sold_units, giveaway_units, returned_units,
        lost_units, damaged_units, rekit_units, gross_sales_amount,
        finance_reference, evidence_url, note, prepared_by, prepared_at,
        updated_at
      ) values (
        v_event.id,
        case when v_action = 'submit' then 'submitted' else 'draft' end,
        coalesce((payload->>'sold_units')::integer, 0),
        coalesce((payload->>'giveaway_units')::integer, 0),
        coalesce((payload->>'returned_units')::integer, 0),
        coalesce((payload->>'lost_units')::integer, 0),
        coalesce((payload->>'damaged_units')::integer, 0),
        coalesce((payload->>'rekit_units')::integer, 0),
        coalesce((payload->>'gross_sales_amount')::numeric, 0),
        nullif(pg_catalog.btrim(payload->>'finance_reference'), ''),
        nullif(pg_catalog.btrim(payload->>'evidence_url'), ''),
        nullif(pg_catalog.btrim(payload->>'note'), ''),
        auth.uid(), now(), now()
      )
      returning * into v_reconciliation;
    else
      update warehouse.event_reconciliations set
        status = case when v_action = 'submit' then 'submitted' else 'draft' end,
        sold_units = coalesce((payload->>'sold_units')::integer, 0),
        giveaway_units = coalesce((payload->>'giveaway_units')::integer, 0),
        returned_units = coalesce((payload->>'returned_units')::integer, 0),
        lost_units = coalesce((payload->>'lost_units')::integer, 0),
        damaged_units = coalesce((payload->>'damaged_units')::integer, 0),
        rekit_units = coalesce((payload->>'rekit_units')::integer, 0),
        gross_sales_amount = coalesce((payload->>'gross_sales_amount')::numeric, 0),
        finance_reference = nullif(pg_catalog.btrim(payload->>'finance_reference'), ''),
        evidence_url = nullif(pg_catalog.btrim(payload->>'evidence_url'), ''),
        note = nullif(pg_catalog.btrim(payload->>'note'), ''),
        prepared_by = auth.uid(), prepared_at = now(),
        approved_by = null, approved_at = null, updated_at = now()
      where event_id = v_event.id
        and updated_at = v_expected_updated_at
      returning * into v_reconciliation;
      if not found then
        raise exception 'Event reconciliation changed; refresh and try again';
      end if;
    end if;
  else
    if v_reconciliation.event_id is null
       or v_reconciliation.status <> 'submitted' then
      raise exception 'Submit the event reconciliation before Finance approval';
    end if;
    if v_reconciliation.prepared_by = auth.uid() then
      raise exception 'A second Finance user must approve the event settlement';
    end if;
    v_accounted := v_reconciliation.sold_units
      + v_reconciliation.giveaway_units
      + v_reconciliation.returned_units
      + v_reconciliation.lost_units
      + v_reconciliation.damaged_units
      + v_reconciliation.rekit_units;
    if v_accounted <> v_issued then
      raise exception 'Event outcomes must account for all issued units';
    end if;
    if nullif(pg_catalog.btrim(v_reconciliation.finance_reference), '') is null
       or nullif(pg_catalog.btrim(v_reconciliation.evidence_url), '') is null then
      raise exception 'Finance reference and evidence are required for approval';
    end if;
    update warehouse.event_reconciliations set
      status = 'approved', approved_by = auth.uid(), approved_at = now(),
      updated_at = now()
    where event_id = v_event.id
      and updated_at = v_expected_updated_at
    returning * into v_reconciliation;
    if not found then
      raise exception 'Event reconciliation changed; refresh and try again';
    end if;
  end if;

  insert into core.activity_log(
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'events', 'event_reconciliation', v_event.id, v_action, auth.uid(),
    jsonb_build_object(
      'status', v_reconciliation.status,
      'issued_units', v_issued,
      'prepared_by', v_reconciliation.prepared_by,
      'approved_by', v_reconciliation.approved_by
    )
  );
  return to_jsonb(v_reconciliation);
end;
$$;
revoke all on function warehouse.save_event_reconciliation(jsonb)
  from public, anon;
grant execute on function warehouse.save_event_reconciliation(jsonb)
  to authenticated, service_role;

create or replace function core.manage_finance_close_entry(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry core.finance_close_entries;
  v_action text := payload->>'action';
  v_expected_updated_at timestamptz;
  v_requested_id uuid := nullif(payload->>'id', '')::uuid;
begin
  if not core.has_cap('warehouse', 'manage_finance_close') then
    raise exception 'Not authorized: warehouse.manage_finance_close';
  end if;

  if v_action = 'save' then
    if payload->>'entry_type' not in (
      'inventory_valuation', 'cogs', 'merchandise_expense', 'cost_center',
      'write_off', 'event_settlement'
    ) then raise exception 'Invalid Finance close entry type'; end if;
    if nullif(pg_catalog.btrim(payload->>'source_reference'), '') is null
       or nullif(pg_catalog.btrim(payload->>'source_module'), '') is null
       or nullif(payload->>'period_start', '') is null
       or nullif(payload->>'period_end', '') is null then
      raise exception 'Period and source reference are required';
    end if;
    if (payload->>'period_end')::date < (payload->>'period_start')::date then
      raise exception 'Period end cannot be before period start';
    end if;

    if v_requested_id is not null then
      select * into v_entry
      from core.finance_close_entries
      where id = v_requested_id
      for update;
      if not found then raise exception 'Finance close entry not found'; end if;
    else
      select * into v_entry
      from core.finance_close_entries
      where entry_type = payload->>'entry_type'
        and source_module = pg_catalog.btrim(payload->>'source_module')
        and source_reference = pg_catalog.btrim(payload->>'source_reference')
        and period_end = (payload->>'period_end')::date
      for update;
    end if;

    if v_entry.id is not null then
      if v_entry.status in ('posted', 'reconciled') then
        raise exception 'Posted or reconciled Finance close entries are immutable';
      end if;
      if nullif(payload->>'expected_updated_at', '') is null then
        raise exception 'Refresh the Finance close entry before updating it';
      end if;
      v_expected_updated_at := (payload->>'expected_updated_at')::timestamptz;
      if v_entry.updated_at is distinct from v_expected_updated_at then
        raise exception 'Finance close entry changed; refresh and try again';
      end if;
      update core.finance_close_entries set
        period_start = (payload->>'period_start')::date,
        period_end = (payload->>'period_end')::date,
        entry_type = payload->>'entry_type',
        source_module = pg_catalog.btrim(payload->>'source_module'),
        source_reference = pg_catalog.btrim(payload->>'source_reference'),
        cost_center = nullif(pg_catalog.btrim(payload->>'cost_center'), ''),
        amount = coalesce((payload->>'amount')::numeric, 0),
        status = 'ready',
        evidence_url = nullif(pg_catalog.btrim(payload->>'evidence_url'), ''),
        reconciliation_note = nullif(
          pg_catalog.btrim(payload->>'reconciliation_note'), ''
        ),
        prepared_by = auth.uid(), prepared_at = now(), updated_at = now()
      where id = v_entry.id and updated_at = v_expected_updated_at
      returning * into v_entry;
      if not found then
        raise exception 'Finance close entry changed; refresh and try again';
      end if;
    else
      insert into core.finance_close_entries(
        id, period_start, period_end, entry_type, source_module,
        source_reference, cost_center, amount, status, evidence_url,
        reconciliation_note, prepared_by, updated_at
      ) values (
        coalesce(v_requested_id, gen_random_uuid()),
        (payload->>'period_start')::date,
        (payload->>'period_end')::date,
        payload->>'entry_type',
        pg_catalog.btrim(payload->>'source_module'),
        pg_catalog.btrim(payload->>'source_reference'),
        nullif(pg_catalog.btrim(payload->>'cost_center'), ''),
        coalesce((payload->>'amount')::numeric, 0),
        'ready',
        nullif(pg_catalog.btrim(payload->>'evidence_url'), ''),
        nullif(pg_catalog.btrim(payload->>'reconciliation_note'), ''),
        auth.uid(), now()
      ) returning * into v_entry;
    end if;
  else
    if v_requested_id is null then
      raise exception 'Finance close entry id is required';
    end if;
    select * into v_entry
    from core.finance_close_entries
    where id = v_requested_id
    for update;
    if not found then raise exception 'Finance close entry not found'; end if;
    if nullif(payload->>'expected_updated_at', '') is null then
      raise exception 'Refresh the Finance close entry before updating it';
    end if;
    v_expected_updated_at := (payload->>'expected_updated_at')::timestamptz;
    if v_entry.updated_at is distinct from v_expected_updated_at then
      raise exception 'Finance close entry changed; refresh and try again';
    end if;

    if v_action = 'post' then
      if v_entry.status <> 'ready' then
        raise exception 'Only a ready entry can be posted';
      end if;
      if v_entry.prepared_by = auth.uid() then
        raise exception 'A second Finance user must post the prepared entry';
      end if;
      if nullif(pg_catalog.btrim(v_entry.evidence_url), '') is null then
        raise exception 'Evidence is required before posting';
      end if;
      update core.finance_close_entries set
        status = 'posted', posted_by = auth.uid(), posted_at = now(),
        updated_at = now()
      where id = v_entry.id and updated_at = v_expected_updated_at
      returning * into v_entry;
    elsif v_action = 'reconcile' then
      if v_entry.status <> 'posted' then
        raise exception 'Post the entry before reconciliation';
      end if;
      update core.finance_close_entries set
        status = 'reconciled',
        reconciliation_note = coalesce(
          nullif(pg_catalog.btrim(payload->>'reconciliation_note'), ''),
          reconciliation_note
        ),
        updated_at = now()
      where id = v_entry.id and updated_at = v_expected_updated_at
      returning * into v_entry;
    elsif v_action = 'exception' then
      if v_entry.status not in ('draft', 'ready') then
        raise exception 'Only a draft or ready entry can be flagged';
      end if;
      update core.finance_close_entries set
        status = 'exception',
        reconciliation_note = nullif(
          pg_catalog.btrim(payload->>'reconciliation_note'), ''
        ),
        updated_at = now()
      where id = v_entry.id and updated_at = v_expected_updated_at
      returning * into v_entry;
    else
      raise exception 'Unsupported Finance close action';
    end if;
    if not found then
      raise exception 'Finance close entry changed; refresh and try again';
    end if;
  end if;

  insert into core.activity_log(
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'finance', 'close_entry', v_entry.id, v_action, auth.uid(),
    jsonb_build_object(
      'entry_type', v_entry.entry_type,
      'status', v_entry.status,
      'amount', v_entry.amount
    )
  );
  return to_jsonb(v_entry);
end;
$$;
revoke all on function core.manage_finance_close_entry(jsonb)
  from public, anon;
grant execute on function core.manage_finance_close_entry(jsonb)
  to authenticated, service_role;
