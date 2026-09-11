-- Restore the Aug16 ownerless read boundary overwritten by Aug22.
-- Do not assign historical owners. Keep Aug22 requirements and underlying policy decisions.
create or replace function procurement.commitment_readiness(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_requester_id uuid;
  v_has_control_access boolean;
  v_readiness jsonb;
  v_requirement jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select requester_id into v_requester_id from procurement.requests where id=payload->>'request_id';
  if not found then raise exception 'Procurement request not found'; end if;

  v_has_control_access := coalesce(
    core.has_live_cap('procurement','view_dashboard')
    or core.has_live_cap('procurement','author_po')
    or core.has_live_cap('procurement','approve_award'),
    false
  );
  if v_requester_id is null and not v_has_control_access then
    raise exception 'Procurement request has no active owner';
  end if;
  if v_requester_id is not null and auth.uid() <> v_requester_id and not v_has_control_access then
    raise exception 'Not authorized to view commitment readiness';
  end if;
  v_readiness:=private.procurement_commitment_readiness(payload->>'request_id',nullif(payload->>'vendor_id','')::uuid,coalesce(nullif(payload->>'phase',''),'issue'));
  v_requirement:=coalesce((select jsonb_agg(jsonb_build_object('kind',coalesce(item->>'controlCode','required_control'),'label',coalesce(item->>'controlCode','Required control'),'status',case when item->>'reviewStatus'='approved' then 'present' else 'missing' end,'basis',coalesce(v_readiness->>'route','policy route'),'source','Governed policy evidence','owner','Procurement','recovery',case when item->>'reviewStatus'='approved' then 'No action required.' else 'Provide current approved evidence before issue.' end)) from jsonb_array_elements(coalesce(v_readiness->'evidence','[]'::jsonb)) item),'[]'::jsonb) || coalesce((select jsonb_agg(jsonb_build_object('kind','blocker:'||replace(value,' ','_'),'label',value,'status','missing','basis',coalesce(v_readiness->>'route','policy route'),'source','Server commitment predicate','owner','Procurement','recovery','Resolve this server-derived blocker before issue.')) from jsonb_array_elements_text(coalesce(v_readiness->'blockers','[]'::jsonb)) value),'[]'::jsonb);
  return v_readiness || jsonb_build_object('requirements',v_requirement,'canRecordAcceptance',coalesce(auth.uid()=v_requester_id,false) or exists(select 1 from procurement.acceptance_reviewer_assignments assignment where assignment.request_id=payload->>'request_id' and assignment.reviewer_id=auth.uid() and assignment.superseded_at is null));
end;
$$;

alter function procurement.commitment_readiness(jsonb) owner to postgres;
revoke all on function procurement.commitment_readiness(jsonb) from public, anon;
grant execute on function procurement.commitment_readiness(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
