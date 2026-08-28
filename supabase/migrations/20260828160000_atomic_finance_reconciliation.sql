-- Preserve the existing wrapper chain and all of its authority/concurrency checks.
-- Only the underlying reconcile UPDATE changes: status and attributable actor
-- must become visible to the Event lineage trigger in the same row transition.

create or replace function core.manage_finance_close_entry_uncertified_impl(payload jsonb)
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
        status = 'reconciled', reconciled_by = auth.uid(), reconciled_at = now(),
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

revoke all on function core.manage_finance_close_entry_uncertified_impl(jsonb)
  from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');

