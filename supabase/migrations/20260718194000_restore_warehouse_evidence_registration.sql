-- Forward convergence for Warehouse evidence metadata registration. Files
-- remain in the private evidence bucket; this helper records governed metadata.
create or replace function warehouse.register_evidence_docs(
  p_entity_type text,
  p_entity_id text,
  p_paths jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_entity_id text;
begin
  if p_entity_id is null or jsonb_typeof(p_paths)<>'array' then return; end if;
  v_entity_id := p_entity_id;
  for v_path in select jsonb_array_elements_text(p_paths) loop
    if v_path is null or length(btrim(v_path))=0 then continue; end if;
    insert into core.documents(
      entity_type,entity_id,doc_type,storage_path,version,status,uploaded_by
    )
    select p_entity_type,v_entity_id,'evidence',v_path,1,'submitted',auth.uid()
    where not exists(
      select 1 from core.documents document
      where document.entity_type=p_entity_type
        and document.entity_id=v_entity_id
        and document.storage_path=v_path
    );
  end loop;
end;
$$;
revoke all on function warehouse.register_evidence_docs(text,text,jsonb)
  from public,anon,authenticated;
