-- core.documents uses a polymorphic text entity identifier. Preserve the
-- original Warehouse id so evidence remains directly joinable to its source.
do $$
declare
  target constant regprocedure :=
    'warehouse.register_evidence_docs(text,text,jsonb)'::regprocedure;
  definition text := pg_get_functiondef(target);
  corrected_definition text;
begin
  if position('v_entity_id text;' in definition)>0 then return; end if;
  corrected_definition := replace(definition,'v_entity_id uuid;','v_entity_id text;');
  corrected_definition := replace(
    corrected_definition,
    'v_entity_id := md5(p_entity_type||'':''||p_entity_id)::uuid;',
    'v_entity_id := p_entity_id;'
  );
  if corrected_definition=definition then
    raise exception 'Unable to align Warehouse evidence entity identity';
  end if;
  execute corrected_definition;
end;
$$;
