-- Keep the certified public command and existing metadata/audit implementation.
-- Its historical inner read-role gates must not reject certified export actors.
do $migration$
declare
  definition text;
  old_guard text;
  new_guard text;
  correction_guard text := 'and source.export_type = v_kind';
begin
  definition := replace(pg_catalog.pg_get_functiondef('warehouse.register_export_job_uncertified_impl(jsonb)'::regprocedure), chr(13), '');
  old_guard := $old$if not (
    core.has_cap('warehouse', 'view_analytics')
    or core.has_cap('warehouse', 'view_finance')
  ) then$old$;
  new_guard := $new$if auth.uid() is null or not (
    coalesce(core.has_live_cap('warehouse', 'register_exports'), false)
    or coalesce(core.has_live_cap('insights', 'prepare_exports'), false)
  ) then$new$;
  if length(definition) - length(replace(definition, old_guard, '')) <> length(old_guard)
    or length(definition) - length(replace(definition, correction_guard, '')) <> length(correction_guard) then
    raise exception 'Unexpected export registration implementation; review before changing authority';
  end if;
  definition := replace(definition, old_guard, new_guard);
  definition := replace(definition, correction_guard, correction_guard || $scope$
       and (source.created_by = auth.uid() or coalesce(core.has_live_cap('warehouse', 'review_exports'), false))$scope$);
  execute definition;

  definition := replace(pg_catalog.pg_get_functiondef('warehouse.prepare_export_download_pre_insights_certification(jsonb)'::regprocedure), chr(13), '');
  old_guard := $old$if not (
    v_job.created_by = auth.uid()
    or core.has_cap('warehouse', 'view_analytics')
    or core.has_cap('warehouse', 'view_finance')
  ) then$old$;
  new_guard := $new$if auth.uid() is null or not (
    coalesce(core.has_live_cap('warehouse', 'review_exports'), false)
    or (v_job.created_by = auth.uid() and (
      (v_job.export_type = 'insights_snapshot' and coalesce(core.has_live_cap('insights', 'prepare_exports'), false))
      or (v_job.export_type <> 'insights_snapshot' and coalesce(core.has_live_cap('warehouse', 'register_exports'), false))
    ))
  ) then$new$;
  if length(definition) - length(replace(definition, old_guard, '')) <> length(old_guard) then
    raise exception 'Unexpected export download implementation; review before changing authority';
  end if;
  execute replace(definition, old_guard, new_guard);
end;
$migration$;

-- RLS on export_jobs must not make a registered artifact look unregistered.
-- This private predicate exposes only one bit about the caller's own path.
create function private.warehouse_export_is_unregistered(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.uid() is not null
    and p_path like 'exports/' || auth.uid()::text || '/%'
    and not exists (select 1 from warehouse.export_jobs job where job.storage_path = p_path), false);
$$;
revoke all on function private.warehouse_export_is_unregistered(text) from public, anon, authenticated, service_role;
grant execute on function private.warehouse_export_is_unregistered(text) to authenticated;

create policy warehouse_exports_own_temporary_read on storage.objects
for select to authenticated using (
  bucket_id = 'warehouse-exports'
  and owner_id = auth.uid()::text
  and (coalesce(core.has_live_cap('warehouse', 'register_exports'), false)
    or coalesce(core.has_live_cap('insights', 'prepare_exports'), false))
  and private.warehouse_export_is_unregistered(name)
);

drop policy warehouse_exports_orphan_cleanup on storage.objects;
create policy warehouse_exports_orphan_cleanup on storage.objects
for delete to authenticated using (
  bucket_id = 'warehouse-exports'
  and owner_id = auth.uid()::text
  and (coalesce(core.has_live_cap('warehouse', 'register_exports'), false)
    or coalesce(core.has_live_cap('insights', 'prepare_exports'), false))
  and private.warehouse_export_is_unregistered(name)
);

notify pgrst, 'reload schema';
