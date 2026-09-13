-- Optional customer lineage, with no new intake/quality gates.
alter table warehouse.returns
  add column source_order_id uuid references warehouse.fulfillment_orders(id) on delete restrict,
  add column return_case_id uuid references warehouse.customer_return_cases(id) on delete restrict,
  add constraint returns_customer_lineage check (
    (source_order_id is null and return_case_id is null)
    or (source = 'customer' and source_order_id is not null)
  );
create index warehouse_returns_source_order_idx on warehouse.returns(source_order_id);
create index warehouse_returns_return_case_idx on warehouse.returns(return_case_id);

create function private.validate_return_customer_lineage(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid := nullif(payload#>>'{return,source_order_id}', '')::uuid;
  v_case_id uuid := nullif(payload#>>'{return,return_case_id}', '')::uuid;
  v_order warehouse.fulfillment_orders;
  v_case warehouse.customer_return_cases;
  v_line jsonb;
  v_serial text;
begin
  if v_order_id is null and v_case_id is null then return '{}'::jsonb; end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if payload#>>'{return,source}' is distinct from 'customer' then
    raise exception 'Order and case links are only available for customer returns';
  end if;
  if v_case_id is not null then
    select * into v_case from warehouse.customer_return_cases where id = v_case_id for share;
    -- Match customer_return_cases_read; the caller remains the governed intake RPC.
    if not found or not coalesce(v_case.created_by = auth.uid()
      or core.has_cap('warehouse', 'manage_returns')
      or core.has_cap('warehouse', 'approve_stock_adjustment_finance'), false) then
      raise exception 'Customer return case unavailable or outside your access';
    end if;
    if v_case.source_order_id is null or (v_order_id is not null and v_order_id <> v_case.source_order_id) then
      raise exception 'Customer return case does not match the original order';
    end if;
    v_order_id := v_case.source_order_id;
  end if;
  select * into v_order from warehouse.fulfillment_orders where id = v_order_id for share;
  -- Match fulfillment_orders_read without querying a recursive RLS policy as owner.
  if not found or not coalesce(v_order.created_by = auth.uid()
    or exists(select 1 from warehouse.department_stock_requests r
      where r.fulfillment_order_id = v_order.id and r.requested_by = auth.uid())
    or core.has_cap('warehouse', 'view_dashboard')
    or core.has_cap('warehouse', 'request_fulfillment')
    or core.has_cap('warehouse', 'reserve_allocate')
    or core.has_cap('warehouse', 'issue_items'), false) then
    raise exception 'Original order unavailable or outside your access';
  end if;
  for v_line in select * from jsonb_array_elements(payload#>'{return,lines}') loop
    v_serial := nullif(upper(btrim(v_line->>'serialNumber')), '');
    if not exists(select 1 from jsonb_array_elements(v_order.lines) line
      where line->>'productId' = v_line->>'productId'
        and (v_serial is null or exists(select 1 from jsonb_array_elements_text(
          coalesce(line->'pickedSerialNumbers', '[]'::jsonb)) serial where upper(btrim(serial)) = v_serial))) then
      raise exception 'Original order does not contain this product or picked serial';
    end if;
    if v_case_id is not null and (v_case.product_id is distinct from v_line->>'productId'
      or (v_case.serial_number is not null and upper(btrim(v_case.serial_number)) is distinct from v_serial)) then
      raise exception 'Return line does not match the customer case product or serial';
    end if;
  end loop;
  return jsonb_build_object('source_order_id', v_order_id, 'return_case_id', v_case_id);
end $$;
revoke all on function private.validate_return_customer_lineage(jsonb) from public, anon, authenticated, service_role;

-- Patch only the retained implementation. Preserve all existing inventory,
-- certification, allocation and replay code, failing if its anchors have drifted.
do $$
declare
  definition text := pg_get_functiondef('warehouse.record_return_v2_certified_impl(jsonb)'::regprocedure);
  old_text text;
begin
  old_text := 'v_actor text;';
  if strpos(definition, old_text) = 0 then raise exception 'Return intake declaration drift'; end if;
  definition := replace(definition, old_text, 'v_actor text; v_lineage jsonb;');
  old_text := '''lines'', payload#>''{return,lines}'', ''evidence_urls'', v_evidence));';
  if strpos(definition, old_text) = 0 then raise exception 'Return intake hash drift'; end if;
  -- Empty/null optional links add no hash keys: old clients and cached commands survive.
  definition := replace(definition, old_text,
    '''lines'', payload#>''{return,lines}'', ''evidence_urls'', v_evidence) || jsonb_strip_nulls(jsonb_build_object(
      ''source_order_id'', nullif(payload#>>''{return,source_order_id}'', '''')::uuid,
      ''return_case_id'', nullif(payload#>>''{return,return_case_id}'', '''')::uuid)));');
  old_text := 'v_command_id := (v_started->>''command_id'')::uuid;';
  if strpos(definition, old_text) = 0 then raise exception 'Return intake replay boundary drift'; end if;
  definition := replace(definition, old_text, old_text || E'\n  v_lineage := private.validate_return_customer_lineage(payload);');
  old_text := 'insert into warehouse.returns(id, source, event_id, lines, evidence_urls, actor, created_at)';
  if strpos(definition, old_text) = 0 then raise exception 'Return intake insert drift'; end if;
  definition := replace(definition, old_text,
    'insert into warehouse.returns(id, source, event_id, lines, evidence_urls, actor, created_at, source_order_id, return_case_id)');
  old_text := 'v_lines, v_evidence, v_actor, now()) returning * into v_return;';
  if strpos(definition, old_text) = 0 then raise exception 'Return intake values drift'; end if;
  definition := replace(definition, old_text,
    'v_lines, v_evidence, v_actor, now(), (v_lineage->>''source_order_id'')::uuid, (v_lineage->>''return_case_id'')::uuid) returning * into v_return;');
  execute definition;
end $$;

-- Existing table grants/RLS and public RPC authority are intentionally unchanged.
notify pgrst, 'reload schema';
