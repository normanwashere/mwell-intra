-- Complete the governed Event operations -> Finance reconciliation handoff.
-- Event operations owns outcomes and evidence; Finance supplies the settlement
-- reference during approval; Finance close retains its existing independent
-- post and reconcile controls.

alter function private.assert_finance_close_binding(text, text, text, text)
  rename to assert_finance_close_binding_pre_event_handoff;
alter function private.finance_close_evidence_reference(text, text)
  rename to finance_close_evidence_reference_pre_event_handoff;
alter function warehouse.save_event_reconciliation(jsonb)
  rename to save_event_reconciliation_pre_event_handoff;

create or replace function private.is_supported_event_evidence_reference(
  p_reference text
) returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.btrim(p_reference) ~
      '^https://[A-Za-z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$',
    false
  )
$$;

create or replace function private.assert_finance_close_binding(
  p_source_record_type text,
  p_source_record_id text,
  p_evidence_record_type text,
  p_evidence_record_id text
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_source_record_type = 'event_reconciliation'
     and p_evidence_record_type = 'event_reconciliation' then
    if nullif(pg_catalog.btrim(p_source_record_id), '') is null
       or p_source_record_id is distinct from p_evidence_record_id then
      raise exception 'Event settlement evidence must match its reconciliation source';
    end if;
    if not exists (
      select 1
      from warehouse.event_reconciliations reconciliation
      where reconciliation.event_id = p_source_record_id
        and reconciliation.status = 'approved'
    ) then
      raise exception 'Approved Event reconciliation was not found';
    end if;
    if not exists (
      select 1
      from warehouse.event_reconciliations reconciliation
      where reconciliation.event_id = p_source_record_id
        and private.is_supported_event_evidence_reference(
          reconciliation.evidence_url
        )
    ) then
      raise exception 'Event reconciliation requires a valid HTTPS evidence URL';
    end if;
    return;
  end if;

  perform private.assert_finance_close_binding_pre_event_handoff(
    p_source_record_type,
    p_source_record_id,
    p_evidence_record_type,
    p_evidence_record_id
  );
end;
$$;

create or replace function private.finance_close_evidence_reference(
  p_type text,
  p_id text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reference text;
begin
  if p_type = 'event_reconciliation' then
    select reconciliation.evidence_url
    into v_reference
    from warehouse.event_reconciliations reconciliation
    where reconciliation.event_id = p_id;
    return v_reference;
  end if;

  return private.finance_close_evidence_reference_pre_event_handoff(
    p_type,
    p_id
  );
end;
$$;

create or replace function warehouse.save_event_reconciliation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := payload->>'action';
  v_result jsonb;
  v_reconciliation warehouse.event_reconciliations;
  v_issued integer;
  v_accounted integer;
  v_close_entry_id uuid;
  v_finance_reference text;
begin
  if auth.uid() is null then
    raise exception 'An attributable Event or Finance actor is required';
  end if;

  if v_action in ('save', 'submit') then
    if not core.has_live_cap('events', 'manage_events') then
      raise exception 'Not authorized: events.manage_events';
    end if;
  elsif v_action = 'approve' then
    if not core.has_live_cap('events', 'approve_settlement') then
      raise exception 'Not authorized: events.approve_settlement';
    end if;
  else
    raise exception 'Unsupported reconciliation action';
  end if;

  if v_action = 'submit' then
    if not private.is_supported_event_evidence_reference(
      payload->>'evidence_url'
    ) then
      raise exception 'Use a valid HTTPS evidence URL before Finance submission';
    end if;

    select coalesce(sum(allocation.quantity), 0)::integer
    into v_issued
    from warehouse.allocations allocation
    where allocation.event_id = payload->>'event_id'
      and allocation.status in ('issued', 'returned');

    v_accounted :=
      coalesce((payload->>'sold_units')::integer, 0)
      + coalesce((payload->>'giveaway_units')::integer, 0)
      + coalesce((payload->>'returned_units')::integer, 0)
      + coalesce((payload->>'lost_units')::integer, 0)
      + coalesce((payload->>'damaged_units')::integer, 0)
      + coalesce((payload->>'rekit_units')::integer, 0);
    if v_accounted <> v_issued then
      raise exception 'Event outcomes must account for all issued units before Finance submission';
    end if;
  end if;

  if v_action in ('save', 'submit') then
    return warehouse.save_event_reconciliation_pre_event_handoff(
      payload - 'finance_reference'
    );
  end if;

  v_finance_reference := nullif(
    pg_catalog.btrim(payload->>'finance_reference'),
    ''
  );
  if v_finance_reference is null then
    raise exception 'Finance settlement reference is required for approval';
  end if;

  select *
  into v_reconciliation
  from warehouse.event_reconciliations reconciliation
  where reconciliation.event_id = payload->>'event_id'
  for update;
  if not found or v_reconciliation.status <> 'submitted' then
    raise exception 'Submit the event reconciliation before Finance approval';
  end if;
  if not private.is_supported_event_evidence_reference(
    v_reconciliation.evidence_url
  ) then
    raise exception 'Use a valid HTTPS Event settlement evidence URL for approval';
  end if;

  update warehouse.event_reconciliations
  set finance_reference = v_finance_reference
  where event_id = v_reconciliation.event_id;

  v_result := warehouse.save_event_reconciliation_pre_event_handoff(payload);
  v_close_entry_id := nullif(v_result->>'finance_close_entry_id', '')::uuid;
  if v_close_entry_id is null then
    select settlement.finance_close_entry_id
    into v_close_entry_id
    from warehouse.event_settlements settlement
    where settlement.event_id = v_reconciliation.event_id;
  end if;
  if v_close_entry_id is null then
    raise exception 'Finance close entry was not created for the approved Event settlement';
  end if;

  update core.finance_close_entries
  set source_record_type = 'event_reconciliation',
      source_record_id = v_reconciliation.event_id,
      evidence_record_type = 'event_reconciliation',
      evidence_record_id = v_reconciliation.event_id,
      evidence_url = v_reconciliation.evidence_url,
      updated_at = now()
  where id = v_close_entry_id;
  if not found then
    raise exception 'Finance close entry was not found for the approved Event settlement';
  end if;

  return v_result;
end;
$$;

create or replace function warehouse.open_event_reconciliation_evidence(
  payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id text := nullif(pg_catalog.btrim(payload->>'event_id'), '');
  v_audit_id uuid;
  v_reconciliation warehouse.event_reconciliations;
begin
  if auth.uid() is null then
    raise exception 'An attributable Event or Finance reviewer is required';
  end if;
  if not (
    core.has_live_cap('events', 'view_events')
    or core.has_live_cap('events', 'manage_events')
    or core.has_live_cap('events', 'approve_settlement')
    or core.has_live_cap('warehouse', 'manage_finance_close')
  ) then
    raise exception 'Not authorized: governed Event evidence review';
  end if;

  select *
  into v_reconciliation
  from warehouse.event_reconciliations reconciliation
  where reconciliation.event_id = v_event_id::text;
  if not found then
    raise exception 'Event reconciliation evidence was not found';
  end if;
  if not private.is_supported_event_evidence_reference(
    v_reconciliation.evidence_url
  ) then
    raise exception 'Event reconciliation does not have a valid HTTPS evidence URL';
  end if;

  v_audit_id := (
    pg_catalog.substring(pg_catalog.md5(v_event_id), 1, 8) || '-' ||
    pg_catalog.substring(pg_catalog.md5(v_event_id), 9, 4) || '-' ||
    pg_catalog.substring(pg_catalog.md5(v_event_id), 13, 4) || '-' ||
    pg_catalog.substring(pg_catalog.md5(v_event_id), 17, 4) || '-' ||
    pg_catalog.substring(pg_catalog.md5(v_event_id), 21, 12)
  )::uuid;

  insert into core.activity_log(
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'events', 'event_reconciliation', v_audit_id, 'evidence_opened', auth.uid(),
    jsonb_build_object(
      'event_id', v_event_id,
      'purpose', 'event_settlement_review'
    )
  );

  return jsonb_build_object(
    'event_id', v_event_id,
    'evidence_url', v_reconciliation.evidence_url
  );
end;
$$;

-- Repair any event close entries approved before this handoff completed.
update core.finance_close_entries close_entry
set source_record_type = 'event_reconciliation',
    source_record_id = settlement.event_id,
    evidence_record_type = 'event_reconciliation',
    evidence_record_id = settlement.event_id,
    evidence_url = reconciliation.evidence_url,
    updated_at = now()
from warehouse.event_settlements settlement
join warehouse.event_reconciliations reconciliation
  on reconciliation.event_id = settlement.reconciliation_event_id
where close_entry.id = settlement.finance_close_entry_id
  and reconciliation.status = 'approved'
  and nullif(pg_catalog.btrim(reconciliation.evidence_url), '') is not null;

revoke all on function
  private.assert_finance_close_binding_pre_event_handoff(text, text, text, text),
  private.finance_close_evidence_reference_pre_event_handoff(text, text),
  warehouse.save_event_reconciliation_pre_event_handoff(jsonb)
from public, anon, authenticated;

revoke all on function
  private.assert_finance_close_binding(text, text, text, text),
  private.finance_close_evidence_reference(text, text),
  private.is_supported_event_evidence_reference(text)
from public, anon, authenticated;
grant execute on function
  private.assert_finance_close_binding(text, text, text, text),
  private.finance_close_evidence_reference(text, text),
  private.is_supported_event_evidence_reference(text)
to service_role;

revoke all on function warehouse.save_event_reconciliation(jsonb)
from public, anon;
grant execute on function warehouse.save_event_reconciliation(jsonb)
to authenticated, service_role;

revoke all on function warehouse.open_event_reconciliation_evidence(jsonb)
from public, anon;
grant execute on function warehouse.open_event_reconciliation_evidence(jsonb)
to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
