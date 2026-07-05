-- Mwell Intra — procurement approval-ladder RPCs (Step 3b RPC follow-up)
--
-- Lands the three deferred RPC edits flagged by the STEP-3B-RPC-HOOK markers
-- in 20260706190000_procurement_policy_alignment.sql:
--
--   1. procurement.create_request      — accepts the policy-aligned columns
--      (category, sourcing_method, sourcing_override, cost_center,
--      project_code, budget_code, need/alternatives/risk, philgeps_reference,
--      direct_award_reason, price_reasonableness,
--      vendor_accreditation_required, rfp_quorum_met) and records attachment
--      metadata rows (validated via core.assert_document_valid).
--   2. procurement.submit_request      — builds the approval ladder into
--      procurement.approval_steps SERVER-SIDE via
--      procurement.derive_approval_tiers() (mirror of the client
--      buildApprovalLadder in modules/procurement/src/policy.ts).
--   3. procurement.decide_request_step — NEW: tier-verified, signature-
--      enforced, rate-limited step decisions that advance or terminate the
--      request.
--
-- E-signature columns (RA 8792 §6, mirroring ApprovalSignature in
-- modules/procurement/src/types.ts) are added to procurement.approval_steps;
-- a CHECK constraint makes a signature REQUIRED for approvals (optional for
-- rejections).
--
-- Security model (matches every existing procurement RPC):
--   * SECURITY DEFINER with a pinned search_path;
--   * capability / role gate first, rate limit second;
--   * actor identity ALWAYS from auth.uid() — never from the payload;
--   * revoke from public/anon; grant to authenticated + service_role.
--
-- Re-runnable: add column if not exists, guarded constraints,
-- create-or-replace functions.

set search_path to procurement, core, public;

-- ---------------------------------------------------------------------------
-- 1) approval_steps e-signature columns (mirror of types.ts ApprovalSignature:
--    dataUrl → signature_png, signerName → signer_name, method →
--    signature_method, signedAt → signed_at, userAgent → signer_ua).
-- ---------------------------------------------------------------------------
alter table procurement.approval_steps
  add column if not exists signature_png    text,
  add column if not exists signer_name      text,
  add column if not exists signature_method text,
  add column if not exists signed_at        timestamptz,
  add column if not exists signer_ua        text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'approval_steps_signature_method_check'
  ) then
    alter table procurement.approval_steps
      add constraint approval_steps_signature_method_check check (
        signature_method is null or signature_method in ('drawn', 'typed')
      );
  end if;

  -- Signature REQUIRED for approvals; optional for rejections (a rejection
  -- carries the decision note as its evidence). Also enforced by the RPC
  -- guard below so the error surfaces as a friendly message.
  if not exists (
    select 1 from pg_constraint where conname = 'approval_steps_approved_signature_check'
  ) then
    alter table procurement.approval_steps
      add constraint approval_steps_approved_signature_check check (
        status <> 'approved'
        or (
          signature_png    is not null
          and signer_name      is not null
          and signature_method is not null
          and signed_at        is not null
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) procurement.derive_approval_tiers — SINGLE SOURCE OF TRUTH for the
--    server-side ladder. MIRRORS modules/procurement/src/policy.ts
--    buildApprovalLadder() — change BOTH together:
--
--      * dept_head + procurement_head + final_approver: always (policy §3/§9).
--      * legal: category ∈ {services, subscription, construction, manpower,
--        it_software} (CATEGORY_META.requiresLegal) OR sourcing ∈
--        {direct_award, emergency, rfp} (policy §11 + §9) OR amount ≥
--        1,000,000 (RFP_THRESHOLD, policy §5 — belt-and-suspenders for a
--        sourcing override that keeps 'rfq' above the RFP boundary; the
--        client derives 'rfp' from the same threshold).
--      * finance: amount ≥ 200,000 (FINANCE_TIER_MIN — internal default in
--        policy.ts awaiting DOA confirmation) OR category ∈ {capex,
--        construction, manpower}.
--
--    Order matches policy.ts: dept_head → procurement_head → [legal] →
--    [finance] → final_approver.
-- ---------------------------------------------------------------------------
create or replace function procurement.derive_approval_tiers(
  p_category text,
  p_amount   numeric,
  p_sourcing text
) returns text[]
language sql immutable as $$
  select array['dept_head', 'procurement_head']
    || case
         when p_category in ('services', 'subscription', 'construction', 'manpower', 'it_software')
           or p_sourcing in ('direct_award', 'emergency', 'rfp')
           or coalesce(p_amount, 0) >= 1000000    -- RFP_THRESHOLD (policy §5)
         then array['legal']
         else '{}'::text[]
       end
    || case
         when coalesce(p_amount, 0) >= 200000     -- FINANCE_TIER_MIN (policy.ts)
           or p_category in ('capex', 'construction', 'manpower')
         then array['finance']
         else '{}'::text[]
       end
    || array['final_approver'];
$$;

revoke all on function procurement.derive_approval_tiers(text, numeric, text) from public, anon;
grant execute on function procurement.derive_approval_tiers(text, numeric, text) to authenticated, service_role;

-- Tier display labels (mirror of policy.ts TIER_LABEL).
create or replace function procurement.tier_label(p_tier text)
returns text language sql immutable as $$
  select case p_tier
    when 'dept_head'        then 'Department Head'
    when 'procurement_head' then 'Procurement Head'
    when 'finance'          then 'Finance'
    when 'legal'            then 'Legal'
    when 'final_approver'   then 'Final Approver (DOA)'
    else p_tier
  end;
$$;

revoke all on function procurement.tier_label(text) from public, anon;
grant execute on function procurement.tier_label(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) procurement.create_request — policy-aligned columns + attachment
--    metadata. Keeps the v-160000 rate limit (50/hr). Status is now forced to
--    'draft' server-side: the ladder is built on submit, so allowing a
--    client-sent status would let a request skip straight past it.
-- ---------------------------------------------------------------------------
create or replace function procurement.create_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path = procurement, core, public as $$
declare v procurement.requests; v_att jsonb;
begin
  if not core.has_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.create_request';
  end if;
  perform core.check_rate_limit('procurement.create_request', 50);
  insert into procurement.requests (
    title, description, requester_id, department, status, core_vendor_id, estimated_amount,
    category, sourcing_method, sourcing_override,
    cost_center, project_code, budget_code,
    need_description, alternatives_considered, risk_if_not_procured,
    philgeps_reference, direct_award_reason, price_reasonableness,
    vendor_accreditation_required, rfp_quorum_met
  ) values (
    payload->>'title',
    nullif(payload->>'description', ''),
    auth.uid(),
    nullif(payload->>'department', ''),
    'draft',
    nullif(payload->>'core_vendor_id', '')::uuid,
    nullif(payload->>'estimated_amount', '')::numeric,
    nullif(payload->>'category', ''),
    nullif(payload->>'sourcing_method', ''),
    coalesce((payload->>'sourcing_override')::boolean, false),
    nullif(payload->>'cost_center', ''),
    nullif(payload->>'project_code', ''),
    nullif(payload->>'budget_code', ''),
    nullif(payload->>'need_description', ''),
    nullif(payload->>'alternatives_considered', ''),
    nullif(payload->>'risk_if_not_procured', ''),
    nullif(payload->>'philgeps_reference', ''),
    nullif(payload->>'direct_award_reason', ''),
    nullif(payload->>'price_reasonableness', ''),
    coalesce((payload->>'vendor_accreditation_required')::boolean, false),
    (payload->>'rfp_quorum_met')::boolean
  ) returning * into v;

  -- Attachment METADATA rows (the file itself is uploaded to the
  -- `procurement-requests` bucket by the client; RLS on storage.objects gates
  -- that path). Each entry must carry mime_type + size_bytes and pass the
  -- platform document validator.
  if jsonb_typeof(payload->'attachments') = 'array' then
    for v_att in select * from jsonb_array_elements(payload->'attachments') loop
      if nullif(v_att->>'filename', '') is null
         or nullif(v_att->>'mime_type', '') is null
         or nullif(v_att->>'size_bytes', '') is null then
        raise exception 'Each attachment requires filename, mime_type and size_bytes';
      end if;
      perform core.assert_document_valid(
        v_att->>'mime_type',
        (v_att->>'size_bytes')::bigint
      );
      insert into procurement.request_attachments (
        request_id, filename, mime_type, size_bytes, storage_path, kind, uploaded_by
      ) values (
        v.id,
        v_att->>'filename',
        v_att->>'mime_type',
        (v_att->>'size_bytes')::bigint,
        nullif(v_att->>'storage_path', ''),
        nullif(v_att->>'kind', ''),
        auth.uid()
      );
    end loop;
  end if;

  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v.id, 'created', auth.uid(),
          jsonb_build_object('title', v.title, 'status', v.status,
                             'category', v.category, 'sourcing_method', v.sourcing_method,
                             'attachments', coalesce(jsonb_array_length(payload->'attachments'), 0)));
  return to_jsonb(v);
end; $$;

-- ---------------------------------------------------------------------------
-- 4) procurement.submit_request — builds the ladder server-side.
-- ---------------------------------------------------------------------------
create or replace function procurement.submit_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path = procurement, core, public as $$
declare v procurement.requests; v_id uuid; v_tiers text[];
begin
  v_id := (payload->>'id')::uuid;
  if v_id is null then raise exception 'request id is required'; end if;
  select * into v from procurement.requests where id = v_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v.requester_id <> auth.uid()
     and not core.has_cap('procurement', 'admin') then
    raise exception 'Not authorized to submit this request';
  end if;
  if v.status <> 'draft' then raise exception 'Only draft requests can be submitted'; end if;

  update procurement.requests
     set status = 'submitted', updated_at = now()
   where id = v_id
   returning * into v;

  -- Server-authoritative ladder (never trust a client-sent step list). Only
  -- draft requests reach this point, so no decided steps can exist; the
  -- delete keeps a re-applied ladder idempotent all the same.
  v_tiers := procurement.derive_approval_tiers(v.category, v.estimated_amount, v.sourcing_method);
  delete from procurement.approval_steps where request_id = v_id and status = 'pending';
  insert into procurement.approval_steps (request_id, step_order, tier, status, label)
  select v_id, t.ord, t.tier, 'pending', procurement.tier_label(t.tier)
  from unnest(v_tiers) with ordinality as t(tier, ord);

  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v.id, 'submitted', auth.uid(),
          jsonb_build_object('ladder', to_jsonb(v_tiers),
                             'estimated_amount', v.estimated_amount,
                             'category', v.category,
                             'sourcing_method', v.sourcing_method));
  return to_jsonb(v);
end; $$;

-- ---------------------------------------------------------------------------
-- 5) procurement.decide_request_step — NEW.
--
-- Tier ↔ role mapping (seeded RBAC, 20260706091000 + 20260706100000):
--   dept_head        → procurement role 'approver'
--   procurement_head → procurement role 'procurement_officer' or 'admin'
--   finance          → procurement role 'finance'
--   legal            → ANY legal module role (core.has_module_role('legal'))
--   final_approver   → procurement role 'admin'
--
-- Gate note: the seeded matrix grants `approve_request` only to the approver/
-- admin roles — the finance and legal tiers hold module roles instead — so a
-- bare has_cap('procurement','approve_request') gate would lock out two tiers
-- of their own ladder. The broad gate below admits any potential approver
-- (approve_request holders + procurement/legal module roles); the tier↔role
-- match is the AUTHORITATIVE per-step authorization.
-- ---------------------------------------------------------------------------
create or replace function procurement.decide_request_step(payload jsonb)
returns jsonb language plpgsql security definer set search_path = procurement, core, public as $$
declare
  v_req      procurement.requests;
  v_step     procurement.approval_steps;
  v_id       uuid;
  v_decision text;
  v_sig      jsonb;
  v_tier_ok  boolean;
  v_pending  int;
  v_outcome  text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  -- Vendor-kind sessions are never ladder approvers (the external legal:vendor
  -- role IS a legal module role — without this guard a vendor could pass the
  -- legal-tier mapping below).
  if core.is_vendor() then
    raise exception 'Not authorized: procurement.approve_request';
  end if;
  if not (core.has_cap('procurement', 'approve_request')
          or core.has_module_role('procurement')
          or core.has_module_role('legal')) then
    raise exception 'Not authorized: procurement.approve_request';
  end if;
  perform core.check_rate_limit('procurement.decide_request_step', 60);

  v_id       := (payload->>'request_id')::uuid;
  v_decision := payload->>'decision';
  if v_id is null then raise exception 'request_id is required'; end if;
  if v_decision is null or v_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected, got %', coalesce(v_decision, '(null)');
  end if;

  select * into v_req from procurement.requests where id = v_id for update;
  if not found then raise exception 'Request not found: %', v_id; end if;
  if v_req.status not in ('submitted', 'under_review') then
    raise exception 'Request % is not awaiting approval (status %)', v_id, v_req.status;
  end if;

  -- The NEXT pending step is the only decidable one (ladder is strictly
  -- ordered). An optional step_id in the payload must match it — approving
  -- someone else's tier out of turn is refused, mirroring applyStepDecision
  -- in policy.ts.
  select * into v_step
    from procurement.approval_steps
   where request_id = v_id and status = 'pending'
   order by step_order
   limit 1
   for update;
  if not found then raise exception 'No pending approval step for request %', v_id; end if;
  if nullif(payload->>'step_id', '') is not null
     and (payload->>'step_id')::uuid <> v_step.id then
    raise exception 'Step % is not the next pending step for request %', payload->>'step_id', v_id;
  end if;

  v_tier_ok := case v_step.tier
    when 'dept_head' then exists (
      select 1 from core.user_roles ur
      where ur.user_id = auth.uid() and ur.module = 'procurement' and ur.role = 'approver')
    when 'procurement_head' then exists (
      select 1 from core.user_roles ur
      where ur.user_id = auth.uid() and ur.module = 'procurement'
        and ur.role in ('procurement_officer', 'admin'))
    when 'finance' then exists (
      select 1 from core.user_roles ur
      where ur.user_id = auth.uid() and ur.module = 'procurement' and ur.role = 'finance')
    when 'legal' then core.has_module_role('legal') and not core.is_vendor()
    when 'final_approver' then exists (
      select 1 from core.user_roles ur
      where ur.user_id = auth.uid() and ur.module = 'procurement' and ur.role = 'admin')
    else false
  end;
  if not v_tier_ok then
    raise exception 'Caller does not hold the % tier for the next pending step of request %',
      v_step.tier, v_id;
  end if;

  -- E-signature: REQUIRED for approvals (RA 8792 §6), optional for
  -- rejections. Belt-and-suspenders with the table CHECK constraint.
  v_sig := payload->'signature';
  if jsonb_typeof(v_sig) is distinct from 'object' then v_sig := null; end if;
  if v_decision = 'approved' and (
       v_sig is null
       or nullif(v_sig->>'signature_png', '') is null
       or nullif(v_sig->>'signer_name', '') is null
       or nullif(v_sig->>'signature_method', '') is null
     ) then
    raise exception 'Approvals require an electronic signature (signature_png, signer_name, signature_method)';
  end if;

  update procurement.approval_steps set
    status           = v_decision,
    approver_id      = auth.uid(),
    decided_at       = now(),
    note             = nullif(payload->>'note', ''),
    signature_png    = nullif(v_sig->>'signature_png', ''),
    signer_name      = nullif(v_sig->>'signer_name', ''),
    signature_method = nullif(v_sig->>'signature_method', ''),
    signed_at        = case when v_sig is null then null
                            else coalesce(nullif(v_sig->>'signed_at', '')::timestamptz, now()) end,
    signer_ua        = nullif(v_sig->>'signer_ua', ''),
    updated_at       = now()
  where id = v_step.id;

  -- Advance / terminate: any rejection → request rejected; last approval →
  -- request approved; otherwise the request moves to under_review.
  if v_decision = 'rejected' then
    update procurement.requests set status = 'rejected', updated_at = now() where id = v_id;
    v_outcome := 'rejected';
  else
    select count(*) into v_pending
      from procurement.approval_steps
     where request_id = v_id and status = 'pending';
    if v_pending = 0 then
      update procurement.requests set status = 'approved', updated_at = now() where id = v_id;
      v_outcome := 'approved';
    else
      update procurement.requests set status = 'under_review', updated_at = now()
       where id = v_id and status = 'submitted';
      v_outcome := 'in_progress';
    end if;
  end if;

  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v_id, 'step_decided', auth.uid(),
          jsonb_build_object('step_id', v_step.id, 'step_order', v_step.step_order,
                             'tier', v_step.tier, 'decision', v_decision,
                             'outcome', v_outcome, 'signed', v_sig is not null));

  return jsonb_build_object(
    'request_id', v_id, 'step_id', v_step.id, 'tier', v_step.tier,
    'decision', v_decision, 'outcome', v_outcome
  );
end; $$;

-- ---------------------------------------------------------------------------
-- Grants — never anon; authenticated + service_role only.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_request(jsonb)', 'submit_request(jsonb)', 'decide_request_step(jsonb)'
  ]
  loop
    execute format('revoke all on function procurement.%s from public, anon;', fn);
    execute format('grant execute on function procurement.%s to authenticated, service_role;', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
