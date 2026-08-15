-- Forward-only Procurement / Finance / requester-privacy convergence.
-- This migration deliberately layers over, and does not rewrite, the shared
-- authority remediation migration.

insert into core.capabilities(module, cap) values
  ('procurement', 'manage_request_collaborators'),
  ('procurement', 'cancel_request'),
  ('procurement', 'final_approve_po'),
  ('procurement', 'accept_payment_readiness')
on conflict (module, cap) do nothing;

insert into core.role_capabilities(module, role, cap) values
  ('procurement', 'requester', 'cancel_request'),
  ('procurement', 'procurement_officer', 'manage_request_collaborators'),
  ('procurement', 'procurement_officer', 'cancel_request'),
  ('procurement', 'approver', 'final_approve_po'),
  ('procurement', 'finance', 'accept_payment_readiness'),
  ('procurement', 'finance', 'release_payment'),
  ('procurement', 'admin', 'manage_request_collaborators'),
  ('procurement', 'admin', 'cancel_request'),
  ('procurement', 'admin', 'final_approve_po'),
  ('procurement', 'admin', 'accept_payment_readiness'),
  ('procurement', 'admin', 'release_payment')
on conflict (module, role, cap) do nothing;

insert into learning.mutation_capability_rules(module, capability) values
  ('procurement', 'manage_request_collaborators'),
  ('procurement', 'cancel_request'),
  ('procurement', 'final_approve_po'),
  ('procurement', 'accept_payment_readiness')
on conflict (module, capability) do nothing;

-- Row-specific request visibility. Role possession alone never grants a
-- direct SELECT; intake and approval participants receive attributable grants.
create table if not exists procurement.request_collaborators (
  request_id text not null references procurement.requests(id) on delete cascade,
  user_id uuid not null references core.profiles(id) on delete cascade,
  access_level text not null default 'read'
    check (access_level in ('read', 'contribute', 'approve', 'manage')),
  reason text not null,
  granted_by uuid references core.profiles(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_by uuid references core.profiles(id) on delete restrict,
  revoked_at timestamptz,
  primary key (request_id, user_id)
);
create index if not exists request_collaborators_user_active_idx
  on procurement.request_collaborators(user_id, request_id)
  where revoked_at is null;
alter table procurement.request_collaborators enable row level security;
alter table procurement.request_collaborators force row level security;
revoke all on procurement.request_collaborators from public, anon, authenticated;
grant select on procurement.request_collaborators to authenticated;
grant all on procurement.request_collaborators to service_role;

create or replace function private.can_read_procurement_request(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from procurement.requests request
    where request.id = p_request_id
      and request.requester_id = auth.uid()
  ) or exists (
    select 1 from procurement.request_collaborators collaborator
    where collaborator.request_id = p_request_id
      and collaborator.user_id = auth.uid()
      and collaborator.revoked_at is null
  )
$$;
revoke all on function private.can_read_procurement_request(text) from public, anon;
grant execute on function private.can_read_procurement_request(text) to authenticated, service_role;

drop policy if exists request_collaborators_read on procurement.request_collaborators;
create policy request_collaborators_read on procurement.request_collaborators
for select to authenticated using (
  user_id = auth.uid()
  or exists (
    select 1 from procurement.requests request
    where request.id = request_id and request.requester_id = auth.uid()
  )
);

drop policy if exists read_requests on procurement.requests;
drop policy if exists procurement_requests_read on procurement.requests;
create policy procurement_requests_read on procurement.requests
for select to authenticated using (private.can_read_procurement_request(id));

drop policy if exists read_approval_steps on procurement.approval_steps;
drop policy if exists procurement_steps_read on procurement.approval_steps;
create policy procurement_steps_read on procurement.approval_steps
for select to authenticated using (private.can_read_procurement_request(request_id));

drop policy if exists read_request_attachments on procurement.request_attachments;
drop policy if exists request_attachments_read on procurement.request_attachments;
create policy request_attachments_read on procurement.request_attachments
for select to authenticated using (private.can_read_procurement_request(request_id));

drop policy if exists procurement_requests_auth_read on storage.objects;
create policy procurement_requests_auth_read on storage.objects
for select to authenticated using (
  bucket_id = 'procurement-requests'
  and exists (
    select 1 from procurement.request_attachments attachment
    where attachment.storage_path = name
      and private.can_read_procurement_request(attachment.request_id)
  )
);

drop policy if exists procurement_requests_auth_insert on storage.objects;
create policy procurement_requests_auth_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'procurement-requests'
  and owner_id = auth.uid()::text
  and core.has_live_cap('procurement', 'create_request')
  and (storage.foldername(name))[1] = 'request'
  and (storage.foldername(name))[2] ~ '^req_[A-Za-z0-9_-]{8,}$'
);

create or replace function procurement.manage_request_collaborator(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_request procurement.requests;
  v_profile core.profiles;
  v_saved procurement.request_collaborators;
  v_action text := payload->>'action';
  v_user_id uuid := nullif(payload->>'user_id', '')::uuid;
begin
  if auth.uid() is null then raise exception 'An attributable Procurement actor is required'; end if;
  if not core.has_live_cap('procurement', 'manage_request_collaborators') then
    raise exception 'Not authorized: procurement.manage_request_collaborators';
  end if;
  select * into v_request from procurement.requests where id = payload->>'request_id' for share;
  if not found then raise exception 'Request not found'; end if;
  if v_user_id is null or v_user_id = v_request.requester_id then
    raise exception 'Select a non-owner collaborator';
  end if;
  select * into v_profile from core.profiles where id = v_user_id and status = 'active';
  if not found or v_profile.kind <> 'employee' then raise exception 'An active employee collaborator is required'; end if;
  if v_action = 'grant' then
    if payload->>'access_level' not in ('read', 'contribute', 'approve', 'manage') then
      raise exception 'Invalid request collaborator access level';
    end if;
    if nullif(pg_catalog.btrim(payload->>'reason'), '') is null then
      raise exception 'A collaborator grant reason is required';
    end if;
    insert into procurement.request_collaborators(
      request_id, user_id, access_level, reason, granted_by, granted_at, revoked_by, revoked_at
    ) values (
      v_request.id, v_user_id, payload->>'access_level', pg_catalog.btrim(payload->>'reason'),
      auth.uid(), now(), null, null
    ) on conflict(request_id, user_id) do update set
      access_level = excluded.access_level, reason = excluded.reason,
      granted_by = auth.uid(), granted_at = now(), revoked_by = null, revoked_at = null
    returning * into v_saved;
  elsif v_action = 'revoke' then
    update procurement.request_collaborators set revoked_by = auth.uid(), revoked_at = now()
    where request_id = v_request.id and user_id = v_user_id and revoked_at is null
    returning * into v_saved;
    if not found then raise exception 'Active request collaborator not found'; end if;
  else raise exception 'Unsupported request collaborator action'; end if;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v_request.id, 'collaborator_' || v_action, auth.uid(),
    jsonb_build_object('user_id', v_user_id, 'access_level', v_saved.access_level, 'reason', v_saved.reason));
  return to_jsonb(v_saved);
end $$;
revoke all on function procurement.manage_request_collaborator(jsonb) from public, anon;
grant execute on function procurement.manage_request_collaborator(jsonb) to authenticated, service_role;

-- The same minimum contract is asserted before both draft persistence and
-- submission so a direct RPC cannot bypass the client readiness gate.
create or replace function private.assert_minimum_request_contract(payload jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_line jsonb;
  v_attachments jsonb := coalesce(payload->'attachments', '[]'::jsonb);
begin
  if nullif(pg_catalog.btrim(payload->>'title'), '') is null then raise exception 'Request title is required'; end if;
  if nullif(pg_catalog.btrim(payload->>'department'), '') is null then raise exception 'Department is required'; end if;
  if nullif(pg_catalog.btrim(payload->>'cost_center'), '') is null then raise exception 'Cost center is required'; end if;
  if nullif(payload->>'needed_by', '') is null then raise exception 'Needed-by date is required'; end if;
  if (payload->>'needed_by')::date < current_date then raise exception 'Needed-by date cannot be in the past'; end if;
  if coalesce(nullif(payload->>'estimated_amount', '')::numeric, 0) <= 0 then raise exception 'A positive estimated amount is required'; end if;
  if nullif(pg_catalog.btrim(payload->>'budget_code'), '') is null
     and nullif(pg_catalog.btrim(payload->>'project_code'), '') is null then
    raise exception 'Budget code or project code is required';
  end if;
  if nullif(pg_catalog.btrim(payload#>>'{justification,need}'), '') is null then raise exception 'Business need is required'; end if;
  if jsonb_typeof(coalesce(payload->'lines', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'At least one request line is required';
  end if;
  for v_line in select value from jsonb_array_elements(payload->'lines') loop
    if nullif(pg_catalog.btrim(v_line->>'description'), '') is null
       or coalesce(nullif(v_line->>'quantity', '')::numeric, 0) <= 0 then
      raise exception 'Every request line requires a description and positive quantity';
    end if;
  end loop;
  if jsonb_typeof(v_attachments) <> 'array' then raise exception 'attachments must be an array'; end if;
  if not exists (select 1 from jsonb_array_elements(v_attachments) attachment where attachment->>'kind' = 'spec') then
    raise exception 'Technical description / spec evidence is required';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_attachments) attachment where attachment->>'kind' = 'budget') then
    raise exception 'Approved budget evidence is required';
  end if;
end $$;
revoke all on function private.assert_minimum_request_contract(jsonb) from public, anon, authenticated;
grant execute on function private.assert_minimum_request_contract(jsonb) to service_role;

alter function procurement.create_request(jsonb) rename to create_request_pre_requester_privacy;
create or replace function procurement.create_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_request_id text;
begin
  if auth.uid() is null then raise exception 'An attributable requester is required'; end if;
  if not core.has_live_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.create_request';
  end if;
  perform private.assert_minimum_request_contract(payload);
  v_result := procurement.create_request_pre_requester_privacy(payload);
  v_request_id := v_result->>'id';
  insert into procurement.request_collaborators(request_id, user_id, access_level, reason, granted_by)
  select v_request_id, role.user_id, 'manage', 'system_intake_assignment', auth.uid()
  from core.user_roles role
  join core.profiles profile on profile.id = role.user_id and profile.status = 'active'
  where role.module = 'procurement' and role.role in ('procurement_officer', 'admin')
    and role.user_id <> auth.uid()
  on conflict(request_id, user_id) do update set
    access_level = excluded.access_level, reason = excluded.reason,
    granted_by = excluded.granted_by, granted_at = now(), revoked_by = null, revoked_at = null;
  return v_result;
end $$;
revoke all on function procurement.create_request_pre_requester_privacy(jsonb) from public, anon, authenticated;
revoke all on function procurement.create_request(jsonb) from public, anon;
grant execute on function procurement.create_request(jsonb) to authenticated, service_role;

alter function procurement.submit_request(jsonb) rename to submit_request_pre_requester_privacy;
create or replace function procurement.submit_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request procurement.requests; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'An attributable requester is required'; end if;
  if not core.has_live_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.create_request';
  end if;
  select * into v_request from procurement.requests where id = payload->>'id' for update;
  if not found then raise exception 'Request not found'; end if;
  perform private.assert_minimum_request_contract(to_jsonb(v_request));
  v_result := procurement.submit_request_pre_requester_privacy(payload);
  insert into procurement.request_collaborators(request_id, user_id, access_level, reason, granted_by)
  select v_request.id, step.assigned_user_id, 'approve', 'approval_assignment', auth.uid()
  from procurement.approval_steps step
  where step.request_id = v_request.id and step.assigned_user_id is not null
  on conflict(request_id, user_id) do update set
    access_level = excluded.access_level, reason = excluded.reason,
    granted_by = excluded.granted_by, granted_at = now(), revoked_by = null, revoked_at = null;
  return v_result;
end $$;
revoke all on function procurement.submit_request_pre_requester_privacy(jsonb) from public, anon, authenticated;
revoke all on function procurement.submit_request(jsonb) from public, anon;
grant execute on function procurement.submit_request(jsonb) to authenticated, service_role;

-- Governed request cancellation preserves history, skips only pending approval
-- work, and blocks while sourcing or commitment records remain active.
alter table procurement.requests
  add column if not exists cancellation_version integer not null default 1,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_by uuid references core.profiles(id) on delete restrict,
  add column if not exists cancelled_at timestamptz;

create table if not exists procurement.request_cancellation_commands (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references core.profiles(id) on delete restrict,
  idempotency_key text not null,
  request_id text not null references procurement.requests(id) on delete restrict,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique(actor_id, idempotency_key)
);
alter table procurement.request_cancellation_commands enable row level security;
revoke all on procurement.request_cancellation_commands from public, anon, authenticated;
grant all on procurement.request_cancellation_commands to service_role;

create or replace function procurement.cancel_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_request procurement.requests;
  v_prior procurement.request_cancellation_commands;
  v_actor uuid := auth.uid();
  v_key text := nullif(pg_catalog.btrim(payload->>'idempotency_key'), '');
  v_reason text := nullif(pg_catalog.btrim(payload->>'reason'), '');
  v_expected integer;
  v_blockers jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if v_actor is null then raise exception 'An attributable requester is required'; end if;
  if not core.has_live_cap('procurement', 'cancel_request') then raise exception 'Not authorized: procurement.cancel_request'; end if;
  if v_key is null then raise exception 'idempotency_key is required'; end if;
  if v_reason is null or pg_catalog.char_length(v_reason) < 8 then raise exception 'Cancellation reason must contain at least 8 characters'; end if;
  if nullif(payload->>'expected_version', '') is null then raise exception 'expected_version is required'; end if;
  v_expected := (payload->>'expected_version')::integer;
  select * into v_prior from procurement.request_cancellation_commands
  where actor_id = v_actor and idempotency_key = v_key;
  if found then
    if v_prior.request_id is distinct from payload->>'id' then raise exception 'idempotency_key is already bound to another request'; end if;
    return v_prior.response;
  end if;
  select * into v_request from procurement.requests where id = payload->>'id' for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.requester_id <> v_actor and not exists (
    select 1 from procurement.request_collaborators collaborator
    where collaborator.request_id = v_request.id and collaborator.user_id = v_actor
      and collaborator.revoked_at is null and collaborator.access_level = 'manage'
  ) then raise exception 'Not authorized to cancel this request'; end if;
  if v_request.cancellation_version <> v_expected then raise exception 'Request version changed; refresh and try again'; end if;
  if v_request.status not in ('draft', 'submitted', 'under_review') then raise exception 'Request cannot be cancelled from its current status'; end if;
  if exists (select 1 from procurement.sourcing_events source where source.request_id = v_request.id and source.status <> 'cancelled') then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'type', 'sourcing_event', 'recovery', 'Cancel the active sourcing event before cancelling the request'));
  end if;
  if exists (select 1 from procurement.purchase_orders po where po.request_id = v_request.id and po.status <> 'cancelled') then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'type', 'purchase_order', 'recovery', 'Cancel or close downstream purchase orders before cancelling the request'));
  end if;
  if jsonb_array_length(v_blockers) > 0 then
    v_response := to_jsonb(v_request) || jsonb_build_object('cancelled', false, 'blockers', v_blockers, 'recovery_required', true);
    insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
    values ('procurement', 'request', v_request.id, 'cancellation_blocked', v_actor,
      jsonb_build_object('reason', v_reason, 'blockers', v_blockers));
  else
    update procurement.approval_steps set status = 'skipped',
      note = concat_ws(E'\n', nullif(note, ''), 'Skipped because requester cancelled: ' || v_reason)
    where request_id = v_request.id and status = 'pending';
    update procurement.requests set status = 'cancelled', cancellation_reason = v_reason,
      cancelled_by = v_actor, cancelled_at = now(), cancellation_version = cancellation_version + 1,
      updated_at = now()
    where id = v_request.id and cancellation_version = v_expected returning * into v_request;
    if not found then raise exception 'Request version changed; refresh and try again'; end if;
    v_response := to_jsonb(v_request) || jsonb_build_object('cancelled', true, 'blockers', '[]'::jsonb, 'recovery_required', false);
    insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
    values ('procurement', 'request', v_request.id, 'cancelled', v_actor,
      jsonb_build_object('reason', v_reason, 'version', v_request.cancellation_version));
  end if;
  insert into procurement.request_cancellation_commands(actor_id, idempotency_key, request_id, response)
  values (v_actor, v_key, v_request.id, v_response);
  return v_response;
end $$;
revoke all on function procurement.cancel_request(jsonb) from public, anon;
grant execute on function procurement.cancel_request(jsonb) to authenticated, service_role;

-- PO authoring and final approval are distinct certified duties. Historical
-- actor_id values are retained as the author lineage where available.
alter table procurement.purchase_orders
  add column if not exists authored_by uuid references core.profiles(id) on delete restrict,
  add column if not exists authored_at timestamptz,
  add column if not exists final_approved_by uuid references core.profiles(id) on delete restrict,
  add column if not exists final_approved_at timestamptz;
update procurement.purchase_orders
set authored_by = coalesce(authored_by, actor_id), authored_at = coalesce(authored_at, created_at)
where authored_by is null and actor_id is not null;

alter function procurement.create_purchase_order(jsonb) rename to create_purchase_order_pre_requester_privacy;
create or replace function procurement.create_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_po procurement.purchase_orders;
begin
  if auth.uid() is null then raise exception 'An attributable PO author is required'; end if;
  if not core.has_live_cap('procurement', 'author_po') then raise exception 'Not authorized: procurement.author_po'; end if;
  v_result := procurement.create_purchase_order_pre_requester_privacy(payload);
  update procurement.purchase_orders set authored_by = auth.uid(), authored_at = now(), actor_id = auth.uid()
  where id = v_result->>'id' returning * into v_po;
  return to_jsonb(v_po);
end $$;
revoke all on function procurement.create_purchase_order_pre_requester_privacy(jsonb) from public, anon, authenticated;
revoke all on function procurement.create_purchase_order(jsonb) from public, anon;
grant execute on function procurement.create_purchase_order(jsonb) to authenticated, service_role;

alter function procurement.approve_purchase_order(jsonb) rename to approve_purchase_order_pre_requester_privacy;
create or replace function procurement.approve_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_po procurement.purchase_orders; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'An attributable final PO approver is required'; end if;
  if not core.has_live_cap('procurement', 'final_approve_po') then raise exception 'Not authorized: procurement.final_approve_po'; end if;
  select * into v_po from procurement.purchase_orders where id = payload->>'id' for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_po.authored_by is null then raise exception 'An attributable PO author is required before final approval'; end if;
  if v_po.authored_by = auth.uid() then raise exception 'The PO author cannot perform final approval'; end if;
  v_result := private.policy_approve_purchase_order(payload);
  update procurement.purchase_orders set final_approved_by = auth.uid(), final_approved_at = now(), updated_at = now()
  where id = v_po.id returning * into v_po;
  return to_jsonb(v_po);
end $$;
revoke all on function procurement.approve_purchase_order_pre_requester_privacy(jsonb) from public, anon, authenticated;
revoke all on function procurement.approve_purchase_order(jsonb) from public, anon;
grant execute on function procurement.approve_purchase_order(jsonb) to authenticated, service_role;

create or replace function procurement.issue_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_po procurement.purchase_orders;
begin
  if auth.uid() is null then raise exception 'An attributable PO author is required'; end if;
  if not core.has_live_cap('procurement', 'author_po') then raise exception 'Not authorized: procurement.author_po'; end if;
  select * into v_po from procurement.purchase_orders where id = payload->>'id' for update;
  if not found or v_po.final_approved_by is null then raise exception 'Independent final PO approval is required before issue'; end if;
  v_result := procurement.issue_purchase_order_pre_task1(payload);
  update procurement.purchase_orders set issued_at = coalesce(issued_at, now())
  where id = v_result->>'id' returning * into v_po;
  return to_jsonb(v_po);
end $$;
revoke all on function procurement.issue_purchase_order(jsonb) from public, anon;
grant execute on function procurement.issue_purchase_order(jsonb) to authenticated, service_role;

-- Finance acceptance and release are separate certified actions, even when a
-- user happens to hold both capabilities.
create or replace function procurement.review_payment_readiness(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'An attributable Finance reviewer is required'; end if;
  if not core.has_live_cap('procurement', 'accept_payment_readiness') then
    raise exception 'Not authorized: procurement.accept_payment_readiness';
  end if;
  return procurement.review_payment_readiness_uncertified_impl(payload);
end $$;

create or replace function procurement.release_payment(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pack procurement.payment_readiness_packs;
begin
  if auth.uid() is null then raise exception 'An attributable Finance release actor is required'; end if;
  if not core.has_live_cap('procurement', 'release_payment') then raise exception 'Not authorized: procurement.release_payment'; end if;
  select * into v_pack from procurement.payment_readiness_packs
  where id = (payload->>'payment_readiness_pack_id')::uuid for update;
  if not found or v_pack.status <> 'accepted' or v_pack.finance_reviewed_by is null then
    raise exception 'Finance acceptance is required before payment release';
  end if;
  if v_pack.finance_reviewed_by = auth.uid() then
    raise exception 'A different Finance actor must release an accepted payment';
  end if;
  return procurement.release_payment_uncertified_impl(payload);
end $$;
revoke all on function procurement.review_payment_readiness(jsonb), procurement.release_payment(jsonb) from public, anon;
grant execute on function procurement.review_payment_readiness(jsonb), procurement.release_payment(jsonb) to authenticated, service_role;

-- Finance close entries now carry canonical source/evidence identities. The
-- validation helper proves those records exist before an entry can be saved or
-- transitioned; the old free-text fields remain for historical display only.
alter table core.finance_close_entries
  add column if not exists source_record_type text,
  add column if not exists source_record_id text,
  add column if not exists evidence_record_type text,
  add column if not exists evidence_record_id text;
create index if not exists finance_close_source_record_idx
  on core.finance_close_entries(source_record_type, source_record_id);
create index if not exists finance_close_evidence_record_idx
  on core.finance_close_entries(evidence_record_type, evidence_record_id);

create or replace function private.assert_finance_close_binding(
  p_source_record_type text, p_source_record_id text,
  p_evidence_record_type text, p_evidence_record_id text
) returns void language plpgsql stable security definer set search_path = '' as $$
declare v_related boolean := false;
begin
  if nullif(pg_catalog.btrim(p_source_record_id), '') is null then raise exception 'Canonical Finance source record is required'; end if;
  if nullif(pg_catalog.btrim(p_evidence_record_id), '') is null then raise exception 'Registered Finance evidence is required'; end if;
  if p_source_record_type = 'procurement_request' then
    if not exists(select 1 from procurement.requests where id = p_source_record_id) then raise exception 'Procurement request source record not found'; end if;
  elsif p_source_record_type = 'purchase_order' then
    if not exists(select 1 from procurement.purchase_orders where id = p_source_record_id) then raise exception 'Purchase order source record not found'; end if;
  elsif p_source_record_type = 'payment_readiness_pack' then
    if not exists(select 1 from procurement.payment_readiness_packs where id::text = p_source_record_id) then raise exception 'Payment-readiness source record not found'; end if;
  elsif p_source_record_type = 'payment_release' then
    if not exists(select 1 from procurement.payment_releases where id::text = p_source_record_id) then raise exception 'Payment release source record not found'; end if;
  elsif p_source_record_type = 'warehouse_receipt' then
    if not exists(select 1 from warehouse.receipts where id = p_source_record_id) then raise exception 'Warehouse receipt source record not found'; end if;
  elsif p_source_record_type = 'event_reconciliation' then
    if not exists(select 1 from warehouse.event_reconciliations where event_id = p_source_record_id) then raise exception 'Event reconciliation source record not found'; end if;
  else raise exception 'Unsupported Finance source record type'; end if;

  if p_evidence_record_type = 'request_attachment' then
    if not exists(select 1 from procurement.request_attachments where id = p_evidence_record_id) then raise exception 'Request attachment evidence not found'; end if;
  elsif p_evidence_record_type = 'payment_readiness_pack' then
    if not exists(select 1 from procurement.payment_readiness_packs where id::text = p_evidence_record_id) then raise exception 'Payment-readiness evidence not found'; end if;
  elsif p_evidence_record_type = 'payment_release' then
    if not exists(select 1 from procurement.payment_releases where id::text = p_evidence_record_id) then raise exception 'Payment release evidence not found'; end if;
  elsif p_evidence_record_type = 'core_document' then
    if not exists(select 1 from core.documents where id::text = p_evidence_record_id) then raise exception 'Registered document evidence not found'; end if;
  elsif p_evidence_record_type = 'warehouse_receipt' then
    if not exists(select 1 from warehouse.receipts where id = p_evidence_record_id) then raise exception 'Warehouse receipt evidence not found'; end if;
  else raise exception 'Unsupported Finance evidence record type'; end if;

  if p_evidence_record_type = 'request_attachment' then
    select exists(
      select 1
      from procurement.request_attachments attachment
      left join procurement.purchase_orders po on po.request_id = attachment.request_id
      left join procurement.payment_readiness_packs pack on pack.purchase_order_id = po.id
      left join procurement.payment_releases release on release.purchase_order_id = po.id
      left join warehouse.receipts receipt on receipt.procurement_po_id = po.id
      where attachment.id = p_evidence_record_id
        and (
          (p_source_record_type = 'procurement_request' and attachment.request_id = p_source_record_id)
          or (p_source_record_type = 'purchase_order' and po.id = p_source_record_id)
          or (p_source_record_type = 'payment_readiness_pack' and pack.id::text = p_source_record_id)
          or (p_source_record_type = 'payment_release' and release.id::text = p_source_record_id)
          or (p_source_record_type = 'warehouse_receipt' and receipt.id = p_source_record_id)
        )
    ) into v_related;
  elsif p_evidence_record_type = 'payment_readiness_pack' then
    select exists(
      select 1
      from procurement.payment_readiness_packs pack
      join procurement.purchase_orders po on po.id = pack.purchase_order_id
      left join procurement.payment_releases release on release.payment_readiness_pack_id = pack.id
      left join warehouse.receipts receipt on receipt.procurement_po_id = po.id
      where pack.id::text = p_evidence_record_id
        and (
          (p_source_record_type = 'procurement_request' and po.request_id = p_source_record_id)
          or (p_source_record_type = 'purchase_order' and pack.purchase_order_id = p_source_record_id)
          or (p_source_record_type = 'payment_readiness_pack' and pack.id::text = p_source_record_id)
          or (p_source_record_type = 'payment_release' and release.id::text = p_source_record_id)
          or (p_source_record_type = 'warehouse_receipt' and receipt.id = p_source_record_id)
        )
    ) into v_related;
  elsif p_evidence_record_type = 'payment_release' then
    select exists(
      select 1
      from procurement.payment_releases release
      join procurement.purchase_orders po on po.id = release.purchase_order_id
      left join warehouse.receipts receipt on receipt.procurement_po_id = po.id
      where release.id::text = p_evidence_record_id
        and (
          (p_source_record_type = 'procurement_request' and po.request_id = p_source_record_id)
          or (p_source_record_type = 'purchase_order' and release.purchase_order_id = p_source_record_id)
          or (p_source_record_type = 'payment_readiness_pack' and release.payment_readiness_pack_id::text = p_source_record_id)
          or (p_source_record_type = 'payment_release' and release.id::text = p_source_record_id)
          or (p_source_record_type = 'warehouse_receipt' and receipt.id = p_source_record_id)
        )
    ) into v_related;
  elsif p_evidence_record_type = 'warehouse_receipt' then
    select exists(
      select 1
      from warehouse.receipts receipt
      left join procurement.purchase_orders po on po.id = receipt.procurement_po_id
      left join procurement.payment_readiness_packs pack on pack.purchase_order_id = po.id
      left join procurement.payment_releases release on release.purchase_order_id = po.id
      where receipt.id = p_evidence_record_id
        and (
          (p_source_record_type = 'procurement_request' and po.request_id = p_source_record_id)
          or (p_source_record_type = 'purchase_order' and receipt.procurement_po_id = p_source_record_id)
          or (p_source_record_type = 'payment_readiness_pack' and pack.id::text = p_source_record_id)
          or (p_source_record_type = 'payment_release' and release.id::text = p_source_record_id)
          or (p_source_record_type = 'warehouse_receipt' and receipt.id = p_source_record_id)
        )
    ) into v_related;
  elsif p_evidence_record_type = 'core_document' then
    select exists(
      select 1
      from core.documents document
      where document.id::text = p_evidence_record_id
        and document.entity_id::text = p_source_record_id
        and (
          (p_source_record_type = 'procurement_request' and document.entity_type in ('request', 'procurement_request'))
          or (p_source_record_type = 'purchase_order' and document.entity_type in ('purchase_order', 'procurement_purchase_order'))
          or (p_source_record_type = 'payment_readiness_pack' and document.entity_type = 'payment_readiness_pack')
          or (p_source_record_type = 'payment_release' and document.entity_type = 'payment_release')
          or (p_source_record_type = 'warehouse_receipt' and document.entity_type in ('receipt', 'warehouse_receipt'))
          or (p_source_record_type = 'event_reconciliation' and document.entity_type = 'event_reconciliation')
        )
    ) into v_related;
  end if;

  if not coalesce(v_related, false) then
    raise exception 'Evidence does not belong to the selected Finance source';
  end if;
end $$;
revoke all on function private.assert_finance_close_binding(text, text, text, text) from public, anon, authenticated;
grant execute on function private.assert_finance_close_binding(text, text, text, text) to service_role;

create or replace function private.finance_close_evidence_reference(p_type text, p_id text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_reference text;
begin
  if p_type = 'request_attachment' then select storage_path into v_reference from procurement.request_attachments where id = p_id;
  elsif p_type = 'payment_readiness_pack' then select invoice_or_si_storage_path into v_reference from procurement.payment_readiness_packs where id::text = p_id;
  elsif p_type = 'payment_release' then select payment_reference into v_reference from procurement.payment_releases where id::text = p_id;
  elsif p_type = 'core_document' then select storage_path into v_reference from core.documents where id::text = p_id;
  elsif p_type = 'warehouse_receipt' then select id into v_reference from warehouse.receipts where id = p_id;
  end if;
  return v_reference;
end $$;
revoke all on function private.finance_close_evidence_reference(text, text) from public, anon, authenticated;
grant execute on function private.finance_close_evidence_reference(text, text) to service_role;

create or replace function private.finance_close_actor_lineage(p_entry_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'prepared_by_name', preparer.full_name,
    'prepared_by_email', preparer.email,
    'posted_by_name', poster.full_name,
    'posted_by_email', poster.email,
    'reconciled_by_name', reconciler.full_name,
    'reconciled_by_email', reconciler.email
  )
  from core.finance_close_entries entry
  left join core.profiles preparer on preparer.id = entry.prepared_by
  left join core.profiles poster on poster.id = entry.posted_by
  left join core.profiles reconciler on reconciler.id = entry.reconciled_by
  where entry.id = p_entry_id
    and core.has_live_cap('warehouse', 'manage_finance_close')
$$;
revoke all on function private.finance_close_actor_lineage(uuid) from public, anon;
grant execute on function private.finance_close_actor_lineage(uuid) to authenticated, service_role;

drop view if exists core.finance_close_entry_lineage;
create view core.finance_close_entry_lineage with (security_invoker = true) as
select entry.*,
  actor.lineage->>'prepared_by_name' as prepared_by_name,
  actor.lineage->>'prepared_by_email' as prepared_by_email,
  actor.lineage->>'posted_by_name' as posted_by_name,
  actor.lineage->>'posted_by_email' as posted_by_email,
  actor.lineage->>'reconciled_by_name' as reconciled_by_name,
  actor.lineage->>'reconciled_by_email' as reconciled_by_email
from core.finance_close_entries entry
left join lateral (
  select private.finance_close_actor_lineage(entry.id) as lineage
) actor on true;
grant select on core.finance_close_entry_lineage to authenticated, service_role;

alter function core.manage_finance_close_entry(jsonb) rename to manage_finance_close_entry_pre_requester_privacy;
create or replace function core.manage_finance_close_entry(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_entry core.finance_close_entries;
  v_result jsonb;
  v_source_type text;
  v_source_id text;
  v_evidence_type text;
  v_evidence_id text;
begin
  if auth.uid() is null then raise exception 'Authenticated Finance actor required'; end if;
  if not core.has_live_cap('warehouse', 'manage_finance_close') then raise exception 'Not authorized: warehouse.manage_finance_close'; end if;
  if payload->>'action' = 'save' then
    v_source_type := nullif(payload->>'source_record_type', '');
    v_source_id := nullif(payload->>'source_record_id', '');
    v_evidence_type := nullif(payload->>'evidence_record_type', '');
    v_evidence_id := nullif(payload->>'evidence_record_id', '');
  else
    select * into v_entry from core.finance_close_entries where id = (payload->>'id')::uuid for update;
    if not found then raise exception 'Finance close entry not found'; end if;
    v_source_type := v_entry.source_record_type;
    v_source_id := v_entry.source_record_id;
    v_evidence_type := v_entry.evidence_record_type;
    v_evidence_id := v_entry.evidence_record_id;
  end if;
  perform private.assert_finance_close_binding(v_source_type, v_source_id, v_evidence_type, v_evidence_id);
  v_result := core.manage_finance_close_entry_pre_requester_privacy(
    payload || jsonb_build_object('evidence_url', coalesce(
      nullif(payload->>'evidence_url', ''),
      private.finance_close_evidence_reference(v_evidence_type, v_evidence_id)
    ))
  );
  if payload->>'action' = 'save' then
    update core.finance_close_entries set
      source_record_type = v_source_type, source_record_id = v_source_id,
      evidence_record_type = v_evidence_type, evidence_record_id = v_evidence_id,
      updated_at = now()
    where id = (v_result->>'id')::uuid;
  end if;
  select to_jsonb(lineage) into v_result from core.finance_close_entry_lineage lineage
  where lineage.id = (v_result->>'id')::uuid;
  return v_result;
end $$;
revoke all on function core.manage_finance_close_entry_pre_requester_privacy(jsonb) from public, anon, authenticated;
revoke all on function core.manage_finance_close_entry(jsonb) from public, anon;
grant execute on function core.manage_finance_close_entry(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
