-- UAT-only, idempotent volume fixtures. No approvals, payment, certification,
-- receipt, release or physical stock is fabricated. Existing rows are untouched.
do $seed$
declare employee uuid; operator_id uuid; marketing uuid; source_location text;
begin
  if current_setting('test.seed_project_ref',true) is distinct from 'kkoitlvydytdhlpxhuah' then
    raise exception 'Explicit UAT performance seed target is required';
  end if;
  select id into employee from core.profiles where email='intra.test.employee@mwell.com.ph';
  select id into operator_id from core.profiles where email='intra.test.operations.associate@mwell.com.ph';
  select id into marketing from core.profiles where email='intra.test.marketing.events@mwell.com.ph';
  select id into source_location from warehouse.locations where id='uat-aug24-pasig-main';
  if employee is null or operator_id is null or marketing is null or source_location is null then
    raise exception 'Required UAT test actors/location are missing';
  end if;
  insert into warehouse.products(id,sku,name,category,serialized,item_class,serialization_policy,unit_cost,price,attributes)
  select 'perf-sep12-product-'||i, 'PERF-SEP12-'||lpad(i::text,4,'0'),
    'PERF SEP12 sample '||case when i%3=0 then 'ring ' when i%3=1 then 'merch ' else 'event material ' end||i,
    case when i%3=0 then 'device' else 'merchandise' end, i%3=0,
    case when i%3=0 then 'sellable_sku' when i%3=1 then 'merchandise' else 'event_material' end,
    case when i%3=0 then 'required' else 'none' end, 0,0,
    '{"seed":"PERF-SEP12","purpose":"Synthetic performance fixture; not real stock or pricing"}'::jsonb
  from generate_series(1,300) i on conflict(id) do nothing;

  insert into warehouse.fulfillment_orders(id,source,external_reference,source_location_id,status,lines,created_by,
    ecommerce_channel,order_date,customer_name,customer_contact,delivery_address,payment_status,order_notes)
  select md5('PERF-SEP12-order-'||i)::uuid,'ecommerce','PERF-SEP12-ORDER-'||lpad(i::text,4,'0'),source_location,'received',
    jsonb_build_array(jsonb_build_object('productId','perf-sep12-product-'||i,'quantity',1,'pickedQuantity',0,'pickedSerialNumbers','[]'::jsonb)),
    operator_id,'webstore',current_date,'Synthetic performance recipient','TEST-NO-DELIVERY',
    '{"addressLine":"Synthetic only - do not ship","city":"Test city","province":"Test province","postalCode":"0000"}'::jsonb,
    'pending','PERF-SEP12 synthetic volume fixture. No payment or stock allocated. Do not dispatch.'
  from generate_series(1,200) i on conflict(id) do nothing;

  insert into procurement.requests(id,title,description,requester_id,requester_name,requester_email,status,estimated_amount,lines)
  select 'perf-sep12-request-'||i,'PERF-SEP12 draft purchase request '||i,'Synthetic list-volume fixture; not submitted or approved.',
    employee,'UAT General Employee','intra.test.employee@mwell.com.ph','draft',0,
    jsonb_build_array(jsonb_build_object('id','perf-line-'||i,'description','Synthetic sample','quantity',1,'unitCost',0))
  from generate_series(1,100) i on conflict(id) do nothing;

  insert into warehouse.department_stock_requests(id,requesting_department,purpose,cost_center,required_date,expense_treatment,status,lines,requested_by)
  select md5('PERF-SEP12-department-'||i)::uuid,'marketing','PERF-SEP12 draft stock request '||i,'CC-4100',current_date+7,'expense','draft',
    jsonb_build_array(jsonb_build_object('productId','perf-sep12-product-'||i,'quantity',1)),marketing
  from generate_series(1,50) i on conflict(id) do nothing;
end;
$seed$;
