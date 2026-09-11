-- Read-only UAT benchmark through the actual authenticated database role.
-- Run only after independently verifying project kkoitlvydytdhlpxhuah.
do $bench$
declare users jsonb; u jsonb; i int; started timestamptz; value jsonb; samples jsonb; results jsonb:='[]';
begin
 select jsonb_agg(jsonb_build_object('id',id,'email',email)) into users from auth.users where email in
 (select 'intra.test.'||s||'@mwell.com.ph' from unnest(array['admin','employee','operations.associate','operations.lead','procurement.lead','finance','legal.lead','marketing.events','product.owner','leadership','vendor']) s);
 for u in select * from jsonb_array_elements(users) loop
 perform set_config('request.jwt.claim.sub',u->>'id',true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u->>'id','role','authenticated')::text,true);
 execute 'set local role authenticated'; samples:='[]';
 for i in 1..5 loop started:=clock_timestamp(); value:=core.my_capability_snapshot();
 samples:=samples||to_jsonb(round(extract(epoch from clock_timestamp()-started)*1000,3)); end loop;
 execute 'reset role';
 results:=results||jsonb_build_object('role',u->>'email','snapshot_ms',samples,'hash',md5(value::text));
 end loop;
 perform set_config('test.perf',results::text,true);
end; $bench$;
select current_setting('test.perf')::jsonb as results;
