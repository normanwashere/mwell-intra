-- Candidate only: complete an accepted recommendation through the current
-- governed request creator. Existing drafts and route decisions are untouched.
begin;

create or replace function private.create_replenishment_request(
  p_recommendation procurement.replenishment_recommendations,
  p_request jsonb
)
returns procurement.requests
language plpgsql security definer set search_path = ''
as $$
declare
  v_request procurement.requests;
  v_payload jsonb;
  v_created jsonb;
  v_line jsonb;
  v_attachment jsonb;
  v_id text := p_request->>'id';
  v_amount numeric;
begin
  if auth.uid() is null
     or not core.has_live_cap('procurement','manage_replenishment')
     or not core.has_live_cap('procurement','create_request') then
    raise exception 'Current replenishment management and request creation authority are required';
  end if;
  if p_recommendation.status is distinct from 'accepted' then
    raise exception 'Accept the recommendation before completing the request';
  end if;
  if p_recommendation.procurement_request_id is not null then
    raise exception 'The accepted recommendation already has a request link; review it without replacement';
  end if;
  if jsonb_typeof(p_request) is distinct from 'object'
     or v_id is null or v_id !~ '^req_[A-Za-z0-9_-]{8,}$' then
    raise exception 'A complete request with its reserved evidence identity is required';
  end if;
  if exists (select 1 from procurement.requests where id=v_id) then
    raise exception 'Request identity already exists; review the recorded outcome without replay';
  end if;
  if coalesce(p_request->>'requirement_kind','') not in ('materials','services') then
    raise exception 'Choose an explicit materials or services requirement classification';
  end if;
  if jsonb_typeof(p_request->'lines') is distinct from 'array'
     or jsonb_array_length(p_request->'lines') <> 1 then
    raise exception 'Exactly the accepted replenishment line is required';
  end if;
  v_line := p_request->'lines'->0;
  if v_line->>'description' is distinct from p_recommendation.product_id
     or (v_line->>'quantity')::numeric is distinct from p_recommendation.recommended_quantity::numeric
     or v_line->>'uom' is distinct from 'unit'
     or nullif(btrim(v_line->>'id'),'') is null then
    raise exception 'Request line must preserve the accepted product, quantity and unit';
  end if;
  if coalesce((v_line->>'unitPrice')::numeric,0) <= 0
     or (v_line->>'unitPrice')::numeric::text in ('NaN','Infinity','-Infinity') then
    raise exception 'An explicit positive unit price is required; inventory book cost is not a purchase estimate';
  end if;
  v_amount := p_recommendation.recommended_quantity * (v_line->>'unitPrice')::numeric;
  if jsonb_typeof(p_request->'justification') is distinct from 'object'
     or p_request#>>'{justification,need}' is distinct from p_recommendation.rationale
     or (p_request->'justification' ? 'replenishmentRecommendationId'
       and p_request#>>'{justification,replenishmentRecommendationId}' is distinct from p_recommendation.id::text) then
    raise exception 'Request business need and lineage must preserve the accepted recommendation';
  end if;
  if jsonb_typeof(coalesce(p_request->'compliance','{}'::jsonb)) is distinct from 'object' then
    raise exception 'Request compliance must be an object';
  end if;
  if jsonb_typeof(p_request->'attachments') is distinct from 'array' then
    raise exception 'Private request attachments are required';
  end if;
  for v_attachment in select value from jsonb_array_elements(p_request->'attachments') loop
    perform 1 from storage.objects
      where bucket_id='procurement-requests' and name=v_attachment->>'storage_path'
        and owner_id=auth.uid()::text and split_part(name,'/',1)='request'
        and split_part(name,'/',2)=v_id
      for share;
    if not found then raise exception 'Private request evidence is missing, foreign or outside the request scope'; end if;
  end loop;
  -- Only canonical creation inputs cross this boundary. Identity, status,
  -- lineage and route confirmation are never accepted from caller metadata.
  select jsonb_object_agg(key,value) into v_payload from jsonb_each(p_request)
  where key = any(array['id','title','description','department','cost_center','project_code','budget_code','needed_by',
    'vendor_id','vendor_name','requester_name','requester_email','lines','category','requirement_kind','requested_mode',
    'sourcing_method','sourcing_override','solicitation_requirements','justification','attachments','compliance']);
  v_payload := v_payload || jsonb_build_object(
    'requester_name',(select full_name from core.profiles where id=auth.uid()),
    'requester_email',auth.jwt()->>'email',
    'attachments',(select coalesce(jsonb_agg(value || jsonb_build_object('uploaded_by_email',auth.jwt()->>'email')),'[]'::jsonb)
      from jsonb_array_elements(p_request->'attachments')),
    'estimated_amount',v_amount,
    'justification',(p_request->'justification') || jsonb_build_object('need',p_recommendation.rationale,'replenishmentRecommendationId',p_recommendation.id),
    'compliance',(coalesce(p_request->'compliance','{}'::jsonb) - 'routeConfirmedByEmail')
      || jsonb_build_object('source','warehouse_replenishment','routeConfirmed',false)
  );
  v_created := procurement.create_request(v_payload);
  select * into v_request from procurement.requests where id=v_created->>'id';
  if not found or v_request.id is distinct from v_id or v_request.status is distinct from 'draft'
     or v_request.requester_id is distinct from auth.uid() or v_request.route_confirmed_at is not null then
    raise exception 'Governed creator returned an unexpected draft; handoff rolled back';
  end if;
  return v_request;
end;
$$;
revoke all on function private.create_replenishment_request(procurement.replenishment_recommendations,jsonb)
  from public,anon,authenticated,service_role;

do $migration$
declare
  target regprocedure := to_regprocedure('procurement.manage_replenishment_recommendation_uncertified_impl(jsonb)');
  definition text;
  old_insert constant text := $old_insert$      insert into procurement.requests(
        title, description, requester_id, department, status, category,
        needed_by, justification, compliance, lines
      ) values (
        'Replenish ' || v_row.product_id,
        v_row.rationale || ' Recommended quantity: ' || v_row.recommended_quantity::text || '.',
        auth.uid(), 'operations', 'draft', 'goods',
        current_date + coalesce(v_row.lead_time_days, 0),
        jsonb_build_object(
          'businessNeed', v_row.rationale,
          'replenishmentRecommendationId', v_row.id
        ),
        jsonb_build_object(
          'vendorAccreditationRequired', true,
          'source', 'warehouse_replenishment'
        ),
        jsonb_build_array(jsonb_build_object(
          'description', v_row.product_id,
          'quantity', v_row.recommended_quantity,
          'uom', 'unit'
        ))
      ) returning * into v_request;$old_insert$;
begin
  if target is null then raise exception 'Expected replenishment implementation is missing'; end if;
  definition := replace(pg_get_functiondef(target),E'\r\n',E'\n');
  if (length(definition)-length(replace(definition,old_insert,'')))/length(old_insert) <> 1
     or strpos(definition,'where procurement.replenishment_recommendations.status = ''recommended''')=0
     or strpos(definition,'core.has_live_cap(''procurement'', ''manage_replenishment'')')=0 then
    raise exception 'Unexpected replenishment implementation; review before replacing its handoff';
  end if;
  execute replace(definition,old_insert,'      v_request := private.create_replenishment_request(v_row,payload->''request'');');
end;
$migration$;
revoke all on function procurement.manage_replenishment_recommendation_uncertified_impl(jsonb) from public,anon,authenticated;
commit;
