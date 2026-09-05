-- Separate union migration, immediately after the platform Finance projections.
-- Preserve the installed projection by OID; no other domain's branches are copied or replaced.
alter function core.my_work() rename to platform_previous_my_work;
revoke all on function core.platform_previous_my_work() from public,anon,authenticated;
create function core.my_work()
returns table(id text,principal_id uuid,source text,title text,description text,status text,priority text,due_at timestamptz,href text,required_module text,required_capability text,source_record_exists boolean)
language sql stable security definer set search_path = '' as $$
  select * from core.platform_previous_my_work()
  union all
  select 'product-decision:'||p.id,auth.uid(),'product','Decide '||p.title,'Product Owner decision',p.status,'high',p.submitted_at,'/product#readiness-'||p.id,'product','decide_go_live',true
  from product.readiness_packages p where p.status='submitted' and core.has_live_cap('product','decide_go_live') and p.prepared_by<>auth.uid() and p.submitted_by<>auth.uid()
  union all
  select 'product-handoff:'||p.id,auth.uid(),'product','Operations handoff: '||p.title,'Approved; awaiting Operations acknowledgement',p.status,'high',p.decided_at,'/product#readiness-'||p.id,'product','acknowledge_operations_handoff',true
  from product.readiness_packages p where p.status='approved' and p.is_current and p.operations_acknowledged_at is null and core.has_live_cap('product','acknowledge_operations_handoff')
  union all
  select 'product-price:'||p.id,auth.uid(),'product','Decide price: '||p.product_name,p.reason,p.status,'high',p.effective_at,'/product#pricing-'||p.id,'product','approve_pricing',true
  from product.price_proposals p where p.status='submitted' and core.has_live_cap('product','approve_pricing') and p.proposed_by<>auth.uid()
  union all
  select 'finance-close:'||f.id,auth.uid(),'finance',case when f.status='ready' then 'Post ' else 'Reconcile ' end||f.source_reference,'Independent Finance action',f.status,'high',f.prepared_at,'/finance#close-'||f.id,'warehouse','manage_finance_close',true
  from core.finance_close_entry_authority f where f.status in ('ready','posted') and core.has_live_cap('warehouse','manage_finance_close')
    and f.prepared_by<>auth.uid() and f.settlement_approved_by is distinct from auth.uid()
    and (f.status='ready' or f.posted_by is distinct from auth.uid()) and nullif(btrim(f.evidence_url),'') is not null
  union all
  select 'insight-followup:'||f.id,auth.uid(),'insights','Follow-up: '||f.metric_id,f.reason_code,f.status,'high',f.created_at,'/work#followup-'||f.id,null::text,null::text,true
  from core.insight_followups f where f.status<>'resolved' and core.platform_followup_owner(f.area);
$$;
revoke all on function core.my_work() from public,anon;
grant execute on function core.my_work() to authenticated,service_role;
-- The view must be rebound because function rename preserves its old OID.
create or replace view core.v_my_work with (security_invoker=true) as select * from core.my_work();
notify pgrst, 'reload schema';
