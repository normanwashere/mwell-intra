-- Read-only, authenticated-row comparison for the 11 UAT personas.
do $check$
declare users jsonb; u jsonb; a jsonb; b jsonb; results jsonb:='[]';
begin
 select jsonb_agg(jsonb_build_object('id',id,'email',email)) into users from auth.users where email in
 (select 'intra.test.'||s||'@mwell.com.ph' from unnest(array['admin','employee','operations.associate','operations.lead','procurement.lead','finance','legal.lead','marketing.events','product.owner','leadership','vendor']) s);
 if jsonb_array_length(users)<>11 then raise exception 'Expected exactly 11 UAT personas'; end if;
 for u in select * from jsonb_array_elements(users) loop
 perform set_config('request.jwt.claim.sub',u->>'id',true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u->>'id','role','authenticated')::text,true);
 execute 'set local role authenticated';
 select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg((to_jsonb(q)-'evidence_urls'-'location_id'-'inspected_by_email')::text||case when jsonb_typeof(evidence_urls)='array' then jsonb_array_length(evidence_urls)::text else '0' end,'' order by id),''))) into a from warehouse.quality_inspections q;
 select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg((to_jsonb(q)-'evidence_count')::text||evidence_count::text,'' order by id),''))) into b from warehouse.quality_inspection_queue q;
 execute 'reset role';
 if a<>b then raise exception 'Summary differs for %',u->>'email';end if;
 results:=results||jsonb_build_object('email',u->>'email','result',a,'matched',a=b);
 end loop;
 perform set_config('test.quality_summary',results::text,true);
end; $check$;
select current_setting('test.quality_summary')::jsonb as personas,
  (select jsonb_build_object('count',count(*),'evidence_bytes',sum(octet_length(evidence_urls::text)),
    'hash',md5(string_agg(id::text||evidence_urls::text,'' order by id))) from warehouse.quality_inspections) as source_integrity;
