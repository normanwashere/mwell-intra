do $test$
declare
 v_users jsonb; v_user jsonb; v_uid uuid; v_request uuid; v_requester uuid;
 v_names integer; v_expected boolean; v_resolution text; v_allowed boolean;
 v_checks integer := 0; v_count integer := 0; v_results jsonb := '[]';
begin
 -- Resolve only the named UAT personas, not other application identities.
 select jsonb_agg(jsonb_build_object('id',id,'email',email)) into v_users from auth.users
 where email in (select 'intra.test.' || s || '@mwell.com.ph' from unnest(array['admin','employee','operations.associate','operations.lead','procurement.lead','finance','legal.lead','marketing.events','product.owner','leadership','vendor']) s);
 if jsonb_array_length(v_users) <> 11 then raise exception 'Expected exactly 11 UAT personas'; end if;
 select id,requested_by into v_request,v_requester from warehouse.department_stock_requests order by created_at desc limit 1;
 if v_request is null then raise exception 'A seeded request is required'; end if;
 if exists(select 1 from warehouse.customer_return_cases where id='00000000-0000-0000-0000-000000000000') then raise exception 'Probe identity is not empty'; end if;
 for v_user in select * from jsonb_array_elements(v_users) loop
  v_uid := (v_user->>'id')::uuid;
  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  v_expected := v_uid=v_requester or core.has_live_cap('warehouse','issue_items') or core.has_live_cap('procurement','approve_request');
  select count(*) into v_names from warehouse.department_request_actor_names(array[v_request,'00000000-0000-0000-0000-000000000000'::uuid]);
  if v_names <> (case when v_expected then 1 else 0 end) then raise exception 'Name projection authority mismatch'; end if;
  v_checks := v_checks+1;
  foreach v_resolution in array array['replacement','refund','vendor_return','re_kit','write_off'] loop
   v_allowed := case when v_resolution='refund' then core.has_live_cap('warehouse','approve_stock_adjustment_finance') or core.has_live_cap('procurement','view_finance') else core.has_live_cap('warehouse','manage_returns') end;
   begin
    perform warehouse.resolve_customer_return_case(jsonb_build_object('return_case_id','00000000-0000-0000-0000-000000000000','resolution',v_resolution,'idempotency_key','authority-readonly-probe'));
    raise exception 'Unexpected successful resolution';
   exception when raise_exception then
    if v_allowed and sqlerrm <> 'Return case not found' then raise exception 'Allowed actor did not reach record validation: %',sqlerrm; end if;
    if not v_allowed and sqlerrm not in ('Finance authorization is required for refunds','Not authorized: warehouse.manage_returns') then raise exception 'Denied actor reached record validation: %',sqlerrm; end if;
   end;
   v_checks := v_checks+1;
  end loop;
  execute 'reset role';
  v_count := v_count+1;
  v_results := v_results || jsonb_build_object('persona',v_user->>'email','checks',6,'passed',true);
 end loop;
 perform set_config('test.authority_receipt',jsonb_build_object('personas',v_count,'checks',v_checks,'businessWrites',0,'results',v_results)::text,true);
end; $test$;
select current_setting('test.authority_receipt')::jsonb as result;
