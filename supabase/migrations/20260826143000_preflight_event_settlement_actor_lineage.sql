-- Converge every existing Event settlement close entry before relying on the
-- prospective actor-separation trigger installed by 20260826133000.
-- SHARE locks prevent concurrent Event approval or Finance close mutations
-- from changing the inspected rows until this migration commits.

do $$
begin
  lock table warehouse.event_reconciliations in share mode;
  lock table core.finance_close_entries in share mode;

  if exists (
    select 1
    from core.finance_close_entries close_entry
    left join warehouse.event_reconciliations reconciliation
      on reconciliation.event_id = close_entry.source_record_id
    where close_entry.source_record_type = 'event_reconciliation'
      and (
        reconciliation.event_id is null
        or reconciliation.status <> 'approved'
        or reconciliation.approved_by is null
      )
  ) then
    raise exception 'Existing Event settlement close entry is missing approved reconciliation lineage';
  end if;

  if exists (
    select 1
    from core.finance_close_entries close_entry
    join warehouse.event_reconciliations reconciliation
      on reconciliation.event_id = close_entry.source_record_id
    where close_entry.source_record_type = 'event_reconciliation'
      and close_entry.prepared_by = reconciliation.approved_by
  ) then
    raise exception 'Existing Event settlement preparer and approver must be different actors';
  end if;

  if exists (
    select 1
    from core.finance_close_entries close_entry
    where close_entry.source_record_type = 'event_reconciliation'
      and close_entry.status in ('posted', 'reconciled')
      and close_entry.posted_by is null
  ) then
    raise exception 'Existing posted or reconciled Event settlement requires an attributable poster';
  end if;

  if exists (
    select 1
    from core.finance_close_entries close_entry
    join warehouse.event_reconciliations reconciliation
      on reconciliation.event_id = close_entry.source_record_id
    where close_entry.source_record_type = 'event_reconciliation'
      and close_entry.status in ('posted', 'reconciled')
      and close_entry.posted_by = close_entry.prepared_by
  ) then
    raise exception 'Existing Event settlement preparer and poster must be different actors';
  end if;

  if exists (
    select 1
    from core.finance_close_entries close_entry
    join warehouse.event_reconciliations reconciliation
      on reconciliation.event_id = close_entry.source_record_id
    where close_entry.source_record_type = 'event_reconciliation'
      and close_entry.status in ('posted', 'reconciled')
      and close_entry.posted_by = reconciliation.approved_by
  ) then
    raise exception 'Existing Event settlement approver and poster must be different actors';
  end if;

  if exists (
    select 1
    from core.finance_close_entries close_entry
    where close_entry.source_record_type = 'event_reconciliation'
      and close_entry.status = 'reconciled'
      and close_entry.reconciled_by is null
  ) then
    raise exception 'Existing reconciled Event settlement requires an attributable reconciler';
  end if;

  if exists (
    select 1
    from core.finance_close_entries close_entry
    join warehouse.event_reconciliations reconciliation
      on reconciliation.event_id = close_entry.source_record_id
    where close_entry.source_record_type = 'event_reconciliation'
      and close_entry.status = 'reconciled'
      and close_entry.reconciled_by = close_entry.prepared_by
  ) then
    raise exception 'Existing Event settlement preparer and reconciler must be different actors';
  end if;

  if exists (
    select 1
    from core.finance_close_entries close_entry
    join warehouse.event_reconciliations reconciliation
      on reconciliation.event_id = close_entry.source_record_id
    where close_entry.source_record_type = 'event_reconciliation'
      and close_entry.status = 'reconciled'
      and close_entry.reconciled_by = reconciliation.approved_by
  ) then
    raise exception 'Existing Event settlement approver and reconciler must be different actors';
  end if;

  if exists (
    select 1
    from core.finance_close_entries close_entry
    where close_entry.source_record_type = 'event_reconciliation'
      and close_entry.status = 'reconciled'
      and close_entry.reconciled_by = close_entry.posted_by
  ) then
    raise exception 'Existing Event settlement poster and reconciler must be different actors';
  end if;
end;
$$;
