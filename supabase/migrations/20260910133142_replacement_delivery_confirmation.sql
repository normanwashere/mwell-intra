-- Preserve the existing resolution/authority/idempotency chain and add atomic delivery confirmation.
alter table warehouse.customer_return_cases add column if not exists replacement_delivery jsonb;
alter function warehouse.resolve_customer_return_case(jsonb) rename to resolve_customer_return_case_before_delivery;
alter function warehouse.resolve_customer_return_case_before_delivery(jsonb) set schema private;
revoke all on function private.resolve_customer_return_case_before_delivery(jsonb) from public, anon, authenticated;

create or replace function warehouse.resolve_customer_return_case(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_case warehouse.customer_return_cases;
  v_source warehouse.fulfillment_orders;
  v_result jsonb;
  v_delivery jsonb := nullif(payload->'replacement_delivery', 'null'::jsonb);
  v_address jsonb;
  v_name text;
  v_contact text;
  v_email text;
  v_mode text := v_delivery->>'mode';
  v_order_id uuid;
  v_payload jsonb := payload;
  v_command warehouse.command_log;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if payload->>'resolution' = 'refund' then
    if not (core.has_cap('warehouse', 'approve_stock_adjustment_finance')
      or core.has_cap('procurement', 'view_finance')) then
      raise exception 'Finance authorization is required for refunds';
    end if;
  elsif not core.has_cap('warehouse', 'manage_returns') then
    raise exception 'Not authorized: warehouse.manage_returns';
  end if;
  if payload->>'idempotency_key' is null or payload->>'idempotency_key' !~ '^[A-Za-z0-9_-]{12,128}$' then
    raise exception 'A valid idempotency key is required';
  end if;
  select * into v_case from warehouse.customer_return_cases where id=(payload->>'return_case_id')::uuid for update;
  if not found then raise exception 'Return case not found'; end if;
  if v_case.status in ('resolved','closed') then
    -- Match the predecessor's generated order ID before checking command hashes.
    if payload->>'resolution' = 'replacement' and nullif(payload->>'replacement_order_id','') is null then
      v_payload := jsonb_set(v_payload, '{replacement_order_id}', to_jsonb(v_case.id::text), true);
    end if;
    if v_case.resolution is distinct from payload->>'resolution'
      or v_case.quarantine_bin_id is distinct from nullif(payload->>'quarantine_bin_id','')
      or v_case.replacement_order_id is distinct from nullif(v_payload->>'replacement_order_id','')::uuid
      or v_case.refund_reference is distinct from nullif(pg_catalog.btrim(payload->>'refund_reference'),'')
      or v_case.supplier_reference is distinct from nullif(pg_catalog.btrim(payload->>'supplier_reference'),'')
      or v_case.finance_evidence_url is distinct from nullif(pg_catalog.btrim(payload->>'finance_evidence_url'),'')
      or nullif(v_case.replacement_delivery, 'null'::jsonb) is distinct from v_delivery then
      raise exception 'Return case is already resolved; cannot change its confirmed resolution';
    end if;
    select * into v_command from warehouse.command_log
      where actor_id=auth.uid() and command_name='resolve_customer_return_case'
        and idempotency_key=payload->>'idempotency_key';
    if found then
      if v_command.payload_hash <> private.warehouse_payload_hash(v_payload) then
        raise exception 'Idempotency key was reused with a different payload';
      end if;
      if v_command.response is null then raise exception 'The command is already in progress'; end if;
    end if;
    -- Never delegate a completed case: the original private resolver accepts closed cases.
    return to_jsonb(v_case);
  end if;
  -- Older open-case clients retain their behavior without guessed destinations.
  if payload->>'resolution' <> 'replacement' or v_delivery is null then
    return private.resolve_customer_return_case_before_delivery(payload);
  end if;
  if v_mode is null or v_mode not in ('original','new') then raise exception 'Invalid replacement delivery mode'; end if;
  if nullif(payload->>'replacement_order_id','') is not null then raise exception 'Delivery confirmation requires the case-created replacement order'; end if;
  select * into v_source from warehouse.fulfillment_orders where id=v_case.source_order_id;
  if v_mode = 'original' then
    v_name:=v_source.customer_name; v_contact:=v_source.customer_contact;
    v_email:=v_source.customer_email; v_address:=v_source.delivery_address;
  else
    v_name:=pg_catalog.btrim(v_delivery->>'customerName');
    v_contact:=pg_catalog.btrim(v_delivery->>'customerContactNumber');
    v_email:=nullif(pg_catalog.btrim(v_delivery->>'customerEmail'),'');
    v_address:=v_delivery->'deliveryAddress';
    if nullif(pg_catalog.btrim(v_delivery->>'reason'),'') is null then raise exception 'A reason is required for a new replacement destination'; end if;
  end if;
  if nullif(pg_catalog.btrim(v_name),'') is null or nullif(pg_catalog.btrim(v_contact),'') is null
     or jsonb_typeof(v_address) is distinct from 'object'
     or nullif(pg_catalog.btrim(v_address->>'addressLine'),'') is null
     or nullif(pg_catalog.btrim(v_address->>'city'),'') is null
     or nullif(pg_catalog.btrim(v_address->>'province'),'') is null
     or nullif(pg_catalog.btrim(v_address->>'postalCode'),'') is null then
    raise exception 'Confirm complete replacement customer and delivery details';
  end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Customer email is invalid'; end if;
  -- The private resolver snapshots the case into its response/cache. Stage both
  -- wrapper-owned fields first; any later failure rolls back the entire command.
  update warehouse.customer_return_cases set replacement_delivery=v_delivery,
    finance_evidence_url=nullif(pg_catalog.btrim(payload->>'finance_evidence_url'),'') where id=v_case.id;
  v_result:=private.resolve_customer_return_case_before_delivery(payload);
  v_order_id:=(v_result->>'replacement_order_id')::uuid;
  if v_order_id is null then raise exception 'Replacement order was not created'; end if;
  update warehouse.fulfillment_orders set customer_name=v_name,customer_contact=v_contact,
    customer_email=v_email,delivery_address=v_address where id=v_order_id and status='received';
  if not found then raise exception 'Replacement is no longer awaiting preparation'; end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('warehouse','customer_return_case',v_case.id,'replacement_delivery_confirmed',auth.uid(),
    jsonb_build_object('mode',v_mode,'reason',v_delivery->>'reason','source_order_id',v_case.source_order_id,'replacement_order_id',v_order_id));
  return v_result;
end;
$$;
revoke all on function warehouse.resolve_customer_return_case(jsonb) from public,anon;
grant execute on function warehouse.resolve_customer_return_case(jsonb) to authenticated,service_role;
