-- Private photo evidence: preview own uploads or read exact links on visible
-- warehouse records. Invoker functions deliberately retain each source's RLS.
begin;

update storage.buckets set public = false, file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
where id = 'evidence';

create or replace function private.warehouse_evidence_employee()
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from core.profiles p
    where p.id = auth.uid() and p.kind = 'employee' and p.status = 'active'
  );
$$;

create or replace function private.warehouse_evidence_array_has(paths jsonb, object_name text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_typeof(paths) = 'array' and (
    paths @> jsonb_build_array(object_name)
    or paths @> jsonb_build_array('evidence/' || object_name)
  ), false);
$$;

create or replace function private.warehouse_evidence_value_has(value text, object_name text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(value = object_name or value = 'evidence/' || object_name, false);
$$;

create or replace function private.can_read_registered_warehouse_evidence(object_name text)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.warehouse_evidence_employee() or object_name is null or object_name = '' then
    return false;
  end if;
  if (core.has_cap('warehouse','receive_stock') or core.has_cap('warehouse','inspect_quality')
      or core.has_cap('warehouse','view_finance')) and exists (
    select 1 from warehouse.receipts r
    where private.warehouse_evidence_array_has(r.evidence_urls, object_name)
  ) then return true; end if;

  if (core.has_cap('warehouse','inspect_quality') or core.has_cap('warehouse','view_exceptions')
      or core.has_cap('warehouse','view_finance')) and (
    exists (select 1 from warehouse.quality_inspections r
      where private.warehouse_evidence_array_has(r.evidence_urls, object_name))
    or exists (select 1 from warehouse.inventory_holds r
      where private.warehouse_evidence_array_has(r.evidence_urls, object_name)
         or private.warehouse_evidence_array_has(r.release_evidence_urls, object_name))
  ) then return true; end if;

  if (core.has_cap('warehouse','manage_returns') or core.has_cap('warehouse','inspect_quality')
      or core.has_cap('warehouse','view_finance')) and exists (
    select 1 from warehouse.returns r
    where private.warehouse_evidence_array_has(r.evidence_urls, object_name)
  ) then return true; end if;

  if (core.has_cap('warehouse','inspect_quality') or core.has_cap('warehouse','view_procurement')
      or core.has_cap('warehouse','view_exceptions')) and exists (
    select 1 from warehouse.vendor_returns r
    where private.warehouse_evidence_array_has(r.evidence_urls, object_name)
  ) then return true; end if;

  if (core.has_cap('warehouse','receive_stock') or core.has_cap('warehouse','inspect_quality')
      or core.has_cap('warehouse','manage_returns') or core.has_cap('warehouse','issue_items')
      or core.has_cap('warehouse','cycle_count') or core.has_cap('warehouse','view_finance')) and exists (
    select 1 from warehouse.movements r
    where private.warehouse_evidence_array_has(r.evidence_urls, object_name)
  ) then return true; end if;

  if (core.has_cap('warehouse','cycle_count') or core.has_cap('warehouse','approve_stock_adjustment')
      or core.has_cap('warehouse','view_exceptions')) and exists (
    select 1 from warehouse.stock_change_requests r
    where private.warehouse_evidence_array_has(r.evidence_urls, object_name)
  ) then return true; end if;

  if (core.has_cap('warehouse','request_fulfillment') or core.has_cap('warehouse','request_stock')
      or core.has_cap('warehouse','reserve_allocate') or core.has_cap('warehouse','issue_items')
      or core.has_cap('warehouse','view_finance')) and exists (
    select 1 from warehouse.fulfillment_orders r
    where private.warehouse_evidence_value_has(r.handover_evidence_url, object_name)
       or private.warehouse_evidence_value_has(r.acknowledgement_evidence_url, object_name)
       or private.warehouse_evidence_value_has(r.proof_of_delivery_evidence_url, object_name)
       or exists (
         select 1 from jsonb_array_elements(case when jsonb_typeof(r.lines) = 'array'
           then r.lines else '[]'::jsonb end) line
         where private.warehouse_evidence_value_has(line->>'fulfillmentEvidenceUrl', object_name)
       )
  ) then return true; end if;
  return false;
end;
$$;

revoke all on function private.warehouse_evidence_employee() from public, anon;
revoke all on function private.warehouse_evidence_array_has(jsonb,text) from public, anon;
revoke all on function private.warehouse_evidence_value_has(text,text) from public, anon;
revoke all on function private.can_read_registered_warehouse_evidence(text) from public, anon;
grant execute on function private.warehouse_evidence_employee(),
  private.warehouse_evidence_array_has(jsonb,text), private.warehouse_evidence_value_has(text,text),
  private.can_read_registered_warehouse_evidence(text) to authenticated, service_role;

drop policy if exists evidence_auth_read on storage.objects;
create policy evidence_auth_read on storage.objects for select to authenticated
using (bucket_id = 'evidence' and private.warehouse_evidence_employee()
  and (coalesce(owner_id, owner::text) = auth.uid()::text
    or private.can_read_registered_warehouse_evidence(name)));

drop policy if exists evidence_auth_write on storage.objects;
create policy evidence_auth_write on storage.objects for insert to authenticated
with check (bucket_id = 'evidence' and private.warehouse_evidence_employee()
  and coalesce(owner_id, owner::text) = auth.uid()::text
  and (owner is null or owner = auth.uid()) and (
    core.has_cap('warehouse','receive_stock') or core.has_cap('warehouse','manage_returns')
    or core.has_cap('warehouse','issue_items') or core.has_cap('warehouse','cycle_count')
    or core.has_cap('warehouse','inspect_quality')
  ));

drop policy if exists evidence_auth_delete on storage.objects;
-- Removing a photo from a local form is not permission to destroy its object.
-- Orphan cleanup is a separately governed service operation, not a browser action.
drop policy if exists evidence_no_authenticated_delete on storage.objects;
create policy evidence_no_authenticated_delete on storage.objects as restrictive
for delete to authenticated using (bucket_id <> 'evidence');

commit;
