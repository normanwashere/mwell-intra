-- UAT does not expose the legacy core.check_rate_limit helper. Keep this
-- endpoint's limit local to its private registry and serialize each actor.
create index if not exists action_evidence_actor_created_idx
  on private.action_evidence(uploaded_by, created_at desc);

create or replace function core.prepare_action_evidence(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.action_evidence; v_id uuid:=gen_random_uuid(); v_ext text;
begin
  if not private.can_use_action_evidence(payload->>'source_type',payload->>'source_id',true) then
    raise exception 'Not authorized for this evidence record';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('action-evidence:'||auth.uid()::text,0));
  if (select count(*) from private.action_evidence where uploaded_by=auth.uid()
      and created_at >= now()-interval '1 hour') >= 100 then
    raise exception 'Evidence upload limit reached. Try again later';
  end if;
  v_ext:=case payload->>'mime_type' when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null or length(btrim(coalesce(payload->>'filename','')))=0
    or length(payload->>'filename')>255 or payload->>'filename' ~ '[[:cntrl:]]'
    or length(payload->>'source_id')>255 then raise exception 'Invalid evidence file'; end if;
  if coalesce((payload->>'size_bytes')::bigint,0) not between 1 and 4194304 then
    raise exception 'Choose a non-empty evidence file up to 4 MB'; end if;
  insert into private.action_evidence(id,source_type,source_id,uploaded_by,filename,mime_type,size_bytes,storage_path)
  values(v_id,payload->>'source_type',payload->>'source_id',auth.uid(),payload->>'filename',payload->>'mime_type',
    (payload->>'size_bytes')::bigint,'business-evidence/'||v_id::text||'.'||v_ext) returning * into v;
  return jsonb_build_object('id',v.id,'storage_path',v.storage_path);
end $$;

revoke all on function core.prepare_action_evidence(jsonb) from public,anon;
grant execute on function core.prepare_action_evidence(jsonb) to authenticated,service_role;
select pg_notify('pgrst','reload schema');
