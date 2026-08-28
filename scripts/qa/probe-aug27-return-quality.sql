-- UAT fixture only. Never remove the final rollback or reset a progressed fixture.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9933d59-6993-4d2f-b8c3-824aa9186f14',true);
do $probe$
declare p jsonb; r jsonb; a jsonb; atp_before integer; q jsonb;
begin
  atp_before := warehouse.available_to_promise('uat-aug24-power-watch');
  p := jsonb_build_object('idempotency_key','aug27-rollback-return-intake','return',jsonb_build_object(
    'source','event','event_id','UAT-AUG24-EVENT-A','evidence_urls',jsonb_build_array('https://example.com/aug27-rollback-return'),
    'lines',jsonb_build_array(
      jsonb_build_object('productId','uat-aug24-power-watch','quantity',1,'serialNumber','UAT-A24-POWER-0002','locationId','uat-aug24-pasig-main','binId','uat-aug24-bin-q0101','reason','UAT rollback probe','disposition','quarantine'),
      jsonb_build_object('productId','uat-aug24-power-watch','quantity',1,'serialNumber','UAT-A24-POWER-0003','locationId','uat-aug24-pasig-main','binId','uat-aug24-bin-q0101','reason','UAT rollback probe','disposition','quarantine'),
      jsonb_build_object('productId','uat-aug24-generic-paperbag-white','quantity',3,'locationId','uat-aug24-pasig-main','binId','uat-aug24-bin-q0101','reason','UAT rollback probe','disposition','quarantine'))));
  r := warehouse.record_return_v2(p);
  if warehouse.record_return_v2(p) is distinct from r then raise exception 'Return replay mismatch'; end if;
  if (select count(*) from warehouse.movements where reference=r->>'id') <> 3 then raise exception 'Duplicate or missing movements'; end if;
  if (select count(*) from warehouse.quality_inspections where source_type='return' and source_id=r->>'id' and disposition='pending') <> 3 then raise exception 'Missing return custody'; end if;
  if warehouse.available_to_promise('uat-aug24-power-watch') <> atp_before then raise exception 'Uninspected return became available'; end if;
  perform set_config('request.jwt.claim.sub','60bdca8a-14dd-4297-b9a8-be64e9e7a1cc',true);
  q := jsonb_build_object('idempotency_key','aug27-rollback-return-quality','source_type','return','source_id',r->>'id','product_id','uat-aug24-power-watch','serial_number','UAT-A24-POWER-0002','bin_id','uat-aug24-bin-q0101','quantity',1,'disposition','accepted','evidence_urls',jsonb_build_array('https://example.com/aug27-rollback-quality'));
  a := warehouse.inspect_quality(q);
  if warehouse.inspect_quality(q) is distinct from a then raise exception 'Quality replay mismatch'; end if;
  if not exists(select 1 from warehouse.quality_inspections where source_id=r->>'id' and serial_number='UAT-A24-POWER-0003' and disposition='pending') then raise exception 'Other serial lost pending custody'; end if;
  if warehouse.available_to_promise('uat-aug24-power-watch') <> atp_before+1 then raise exception 'Accepted serial did not become available'; end if;
  perform set_config('qa.aug27_return_probe','PASS: multi-product intake, exact replay, unavailable pending stock, one-unit Quality acceptance, other serial retained; rolled back',true);
end;
$probe$;
select current_setting('qa.aug27_return_probe') as result;
rollback;
