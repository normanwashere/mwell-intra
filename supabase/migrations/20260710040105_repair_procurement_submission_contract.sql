-- Repair the final live Procurement submission contract.
--
-- The live cutover migration redefined submit_request with scalar text
-- concatenation against a text[] (`v_tiers || 'finance'`), which PostgreSQL
-- interprets as an array literal and rejects with 22P02. It also drifted from
-- the application policy by omitting final approval for requests below PHP 1M.

create or replace function procurement.derive_approval_tiers(
  p_category text,
  p_amount numeric,
  p_sourcing text
)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['dept_head', 'procurement_head']::text[]
    || case
         when p_category in (
           'services', 'subscription', 'construction', 'manpower', 'it_software'
         )
           or p_sourcing in ('direct_award', 'emergency', 'rfp')
           or coalesce(p_amount, 0) >= 1000000
         then array['legal']::text[]
         else array[]::text[]
       end
    || case
         when coalesce(p_amount, 0) >= 200000
           or p_category in ('capex', 'construction', 'manpower')
         then array['finance']::text[]
         else array[]::text[]
       end
    || array['final_approver']::text[];
$$;

revoke all on function procurement.derive_approval_tiers(text, numeric, text)
  from public, anon;
grant execute on function procurement.derive_approval_tiers(text, numeric, text)
  to authenticated, service_role;

create or replace function procurement.tier_label(p_tier text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_tier
    when 'dept_head' then 'Department Head'
    when 'procurement_head' then 'Procurement Head'
    when 'finance' then 'Finance'
    when 'legal' then 'Legal'
    when 'final_approver' then 'Final Approver (DOA)'
    else p_tier
  end;
$$;

revoke all on function procurement.tier_label(text) from public, anon;
grant execute on function procurement.tier_label(text)
  to authenticated, service_role;

create or replace function procurement.submit_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v procurement.requests;
  v_id text;
  v_tiers text[];
  v_is_admin boolean;
begin
  v_id := nullif(payload->>'id', '');
  if v_id is null then
    raise exception 'request id is required';
  end if;

  select exists (
    select 1
      from core.user_roles ur
     where ur.user_id = auth.uid()
       and ur.module = 'procurement'
       and ur.role = 'admin'
  ) into v_is_admin;

  select *
    into v
    from procurement.requests r
   where r.id = v_id
   for update;

  if not found then
    raise exception 'Request not found';
  end if;
  if v.requester_id is distinct from auth.uid() and not v_is_admin then
    raise exception 'Not authorized to submit this request';
  end if;
  if v.status <> 'draft' then
    raise exception 'Only draft requests can be submitted';
  end if;

  v_tiers := procurement.derive_approval_tiers(
    v.category,
    v.estimated_amount,
    v.sourcing_method
  );

  update procurement.requests r
     set status = 'submitted',
         submitted_at = now(),
         updated_at = now()
   where r.id = v_id
   returning * into v;

  delete from procurement.approval_steps s where s.request_id = v_id;
  insert into procurement.approval_steps (
    request_id,
    step_order,
    tier,
    status,
    label
  )
  select
    v_id,
    t.ord::int,
    t.tier,
    'pending',
    procurement.tier_label(t.tier)
  from unnest(v_tiers) with ordinality as t(tier, ord);

  insert into core.activity_log (
    module,
    entity_type,
    entity_id,
    action,
    actor,
    detail
  ) values (
    'procurement',
    'request',
    v.id,
    'submitted',
    auth.uid(),
    jsonb_build_object(
      'ladder', to_jsonb(v_tiers),
      'estimated_amount', v.estimated_amount,
      'category', v.category,
      'sourcing_method', v.sourcing_method
    )
  );

  return to_jsonb(v);
end;
$$;

revoke all on function procurement.submit_request(jsonb) from public, anon;
grant execute on function procurement.submit_request(jsonb)
  to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
