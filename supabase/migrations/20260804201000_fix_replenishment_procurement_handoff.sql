-- Align the replenishment handoff with the governed procurement.requests shape.
-- Replaces the initial function without changing its state machine.

create or replace function procurement.manage_replenishment_recommendation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row procurement.replenishment_recommendations;
  v_action text := payload->>'action';
  v_request procurement.requests;
begin
  if not (
    core.has_cap('warehouse','view_procurement')
    or core.has_cap('procurement','manage_rfp')
    or core.has_cap('procurement','author_po')
  ) then raise exception 'Procurement authorization is required'; end if;

  if v_action='recommend' then
    if coalesce((payload->>'recommended_quantity')::integer, 0) <= 0
       or nullif(pg_catalog.btrim(payload->>'rationale'),'') is null
       or payload->>'stockout_risk' not in ('low','medium','high','critical') then
      raise exception 'Quantity, stockout risk, and rationale are required';
    end if;
    insert into procurement.replenishment_recommendations(
      product_id,recommended_quantity,on_hand,reorder_point,lead_time_days,
      status,stockout_risk,rationale
    ) values (
      payload->>'product_id',(payload->>'recommended_quantity')::integer,
      (payload->>'on_hand')::integer,(payload->>'reorder_point')::integer,
      nullif(payload->>'lead_time_days','')::integer,'recommended',
      payload->>'stockout_risk',pg_catalog.btrim(payload->>'rationale')
    ) on conflict(product_id) where status in ('recommended','accepted','handed_off')
    do update set recommended_quantity=excluded.recommended_quantity,
      on_hand=excluded.on_hand,reorder_point=excluded.reorder_point,
      lead_time_days=excluded.lead_time_days,stockout_risk=excluded.stockout_risk,
      rationale=excluded.rationale,created_at=now()
    returning * into v_row;
  else
    select * into v_row from procurement.replenishment_recommendations
    where id=(payload->>'id')::uuid for update;
    if not found then raise exception 'Replenishment recommendation not found'; end if;

    if v_action='accept' then
      if v_row.status <> 'recommended' then raise exception 'Only a recommendation can be accepted'; end if;
      v_row.status:='accepted';
    elsif v_action='handoff' then
      if v_row.status <> 'accepted' then raise exception 'Accept the recommendation before handoff'; end if;
      insert into procurement.requests(
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
      ) returning * into v_request;
      v_row.status:='handed_off';
    elsif v_action='dismiss' then
      if v_row.status not in ('recommended','accepted') then raise exception 'Only an open recommendation can be dismissed'; end if;
      v_row.status:='dismissed';
    else
      raise exception 'Unsupported replenishment action';
    end if;

    update procurement.replenishment_recommendations set
      status=v_row.status,
      procurement_request_id=coalesce(
        v_request.id,
        nullif(payload->>'procurement_request_id',''),
        procurement_request_id
      ),
      decided_by=auth.uid(),
      decided_at=now()
    where id=v_row.id returning * into v_row;
  end if;

  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('procurement','replenishment_recommendation',v_row.id,v_action,auth.uid(),
    jsonb_build_object(
      'product_id',v_row.product_id,
      'status',v_row.status,
      'procurement_request_id',v_row.procurement_request_id
    ));
  return to_jsonb(v_row);
end;
$$;
revoke all on function procurement.manage_replenishment_recommendation(jsonb) from public, anon;
grant execute on function procurement.manage_replenishment_recommendation(jsonb) to authenticated, service_role;
