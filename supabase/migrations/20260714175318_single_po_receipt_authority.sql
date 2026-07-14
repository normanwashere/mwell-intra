-- Warehouse is the single authority for physical procurement PO receipts.
-- Procurement retains only the safe aggregate handoff/status projection.

-- Keep the two legacy operating-role names as exact migration aliases until
-- assignments are remapped to the canonical Operator/Supervisor roles.
delete from core.role_capabilities
where module = 'warehouse' and role in ('operations', 'logistics_supervisor');

insert into core.role_capabilities(module, role, cap)
select module, 'operations', cap
from core.role_capabilities
where module = 'warehouse' and role = 'warehouse_operator'
union all
select module, 'logistics_supervisor', cap
from core.role_capabilities
where module = 'warehouse' and role = 'warehouse_supervisor'
on conflict do nothing;

do $$
begin
  if to_regprocedure('procurement.receive_purchase_order(jsonb)') is not null then
    execute 'revoke all on function procurement.receive_purchase_order(jsonb) from public, anon, authenticated';
    execute 'drop function if exists procurement.receive_purchase_order(jsonb)';
  end if;
  if to_regprocedure('warehouse.receive_against_procurement_po(jsonb)') is not null then
    execute 'revoke all on function warehouse.receive_against_procurement_po(jsonb) from public, anon, authenticated';
    execute 'drop function if exists warehouse.receive_against_procurement_po(jsonb)';
  end if;
end
$$;

alter table procurement.purchase_order_lines
  add column if not exists receiving_status text not null default 'open';

alter table warehouse.quality_inspections
  add column if not exists procurement_po_line_id text;

create index if not exists warehouse_quality_procurement_line_idx
  on warehouse.quality_inspections(procurement_po_line_id, source_id)
  where procurement_po_line_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'procurement_po_line_receiving_status_check'
  ) then
    alter table procurement.purchase_order_lines
      add constraint procurement_po_line_receiving_status_check
      check (receiving_status in ('open', 'rejected', 'cancelled'));
  end if;
end
$$;

do $$
begin
  if to_regprocedure('private.warehouse_receive_procurement_po_legacy(jsonb)') is null
     and to_regprocedure('private.warehouse_receive_procurement_po(jsonb)') is not null then
    alter function private.warehouse_receive_procurement_po(jsonb)
      rename to warehouse_receive_procurement_po_legacy;
  end if;
end
$$;

revoke all on function private.warehouse_receive_procurement_po_legacy(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_receive_procurement_po_legacy(jsonb)
  to service_role;

create or replace function private.warehouse_receive_procurement_po(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po procurement.purchase_orders;
  v_line procurement.purchase_order_lines;
  v_payload_line jsonb;
  v_quantity numeric;
  v_payload_hash text;
  v_existing warehouse.command_log;
  v_response jsonb;
  v_receipt_id text;
  v_short boolean;
  v_closed boolean;
begin
  if not core.has_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: warehouse.receive_stock';
  end if;
  if nullif(payload->>'idempotency_key', '') is null then
    raise exception 'Idempotency key is required';
  end if;
  if jsonb_typeof(payload->'lines') <> 'array'
     or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'At least one procurement PO line is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload->'lines') item
     group by item->>'line_id' having count(*) > 1
  ) then
    raise exception 'A procurement PO line cannot be received twice in one command';
  end if;

  select * into v_po
    from procurement.purchase_orders
   where id::text = payload->>'po_id'
   for update;
  if not found then raise exception 'Procurement purchase order not found'; end if;

  v_payload_hash := private.warehouse_payload_hash(payload);
  select * into v_existing
    from warehouse.command_log
   where actor_id = auth.uid()
     and command_name = 'receive_procurement_po'
     and idempotency_key = payload->>'idempotency_key'
   for update;
  if found then
    if v_existing.payload_hash <> v_payload_hash then
      raise exception 'Idempotency key was already used with a different payload';
    end if;
    if v_existing.completed_at is null or v_existing.response is null then
      raise exception 'Receipt command is already in progress';
    end if;
    return v_existing.response;
  end if;

  if v_po.status <> 'issued' then
    raise exception 'Only issued procurement POs can be received';
  end if;

  -- Lock and validate every requested line before the legacy poster performs
  -- any inventory, movement, quality, or receipt write.
  for v_payload_line in select value from jsonb_array_elements(payload->'lines')
  loop
    select * into v_line
      from procurement.purchase_order_lines
     where id::text = v_payload_line->>'line_id'
       and purchase_order_id = v_po.id
     for update;
    if not found then raise exception 'Procurement PO line not found'; end if;
    if v_line.receiving_status <> 'open' then
      raise exception 'Cancelled or rejected procurement PO lines cannot be received';
    end if;
    if coalesce(nullif(v_payload_line->>'disposition', ''), 'accepted') <> 'accepted' then
      raise exception 'Rejected or quarantined receipt lines cannot post inventory';
    end if;
    begin
      v_quantity := (v_payload_line->>'quantity')::numeric;
    exception when others then
      raise exception 'Warehouse receipt quantity must be a positive whole number';
    end;
    if v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
      raise exception 'Warehouse receipt quantity must be a positive whole number';
    end if;
    if v_line.received_quantity + v_quantity > v_line.quantity then
      raise exception 'Receipt quantity exceeds the procurement PO line balance';
    end if;
  end loop;

  -- The legacy poster inserts one QC row immediately after each payload line.
  -- Feed that trigger an ordered, transaction-local queue so duplicate-product
  -- PO lines retain their exact identity without a product-based guess.
  perform set_config('warehouse.procurement_po_line_queue', (payload->'lines')::text, true);
  v_response := private.warehouse_receive_procurement_po_legacy(payload);
  v_receipt_id := v_response #>> '{receipt,id}';

  if coalesce(current_setting('warehouse.procurement_po_line_queue', true), '[]')::jsonb <> '[]'::jsonb
     or exists (
       select 1 from warehouse.quality_inspections
        where source_type='receipt' and source_id=v_receipt_id
          and procurement_po_line_id is null
     ) then
    raise exception 'Receipt QC could not be bound to every procurement PO line';
  end if;
  perform set_config('warehouse.procurement_po_line_queue', '[]', true);

  select exists (
    select 1
      from procurement.purchase_order_lines line
     where line.purchase_order_id = v_po.id
       and line.receiving_status = 'open'
       and line.received_quantity < line.quantity
  ) into v_short;

  select not exists (
    select 1
      from procurement.purchase_order_lines line
     where line.purchase_order_id = v_po.id
       and line.receiving_status = 'open'
       and line.received_quantity < line.quantity
  ) into v_closed;

  update procurement.purchase_orders
     set status = case when v_closed then 'closed' else 'issued' end,
         updated_at = now()
   where id = v_po.id
   returning * into v_po;

  update warehouse.quality_inspections
     set disposition = 'accepted'
   where source_type = 'receipt'
     and source_id = v_receipt_id
     and disposition = 'pending';
  update warehouse.receipts
     set quality_status = case when v_short then 'partial' else 'accepted' end
   where id = v_receipt_id;

  if v_short then
    insert into warehouse.exceptions(
      exception_type, severity, source_type, source_id, status,
      resolution, created_by
    ) values (
      'po_receipt', 'P2', 'receipt', v_receipt_id, 'open',
      'Short or partial procurement PO receipt requires Warehouse Supervisor review.',
      auth.uid()
    );
  end if;

  v_response := jsonb_set(
    v_response,
    '{receipt,quality_status}',
    to_jsonb(case when v_short then 'partial'::text else 'accepted'::text end),
    true
  );
  v_response := jsonb_set(v_response, '{purchase_order}', to_jsonb(v_po), true);
  update warehouse.command_log
     set response = v_response
   where actor_id = auth.uid()
     and command_name = 'receive_procurement_po'
     and idempotency_key = payload->>'idempotency_key';
  return v_response;
end;
$$;

revoke all on function private.warehouse_receive_procurement_po(jsonb)
  from public, anon;
grant execute on function private.warehouse_receive_procurement_po(jsonb)
  to authenticated, service_role;

create or replace function warehouse.receive_procurement_po(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_receive_procurement_po(payload) $$;

revoke all on function warehouse.receive_procurement_po(jsonb) from public, anon;
grant execute on function warehouse.receive_procurement_po(jsonb)
  to authenticated, service_role;

create or replace function private.bind_quality_procurement_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line_id text;
  v_queue jsonb;
  v_queue_line jsonb;
begin
  if new.source_type <> 'receipt' or new.procurement_po_line_id is not null then return new; end if;
  v_line_id := nullif(current_setting('warehouse.procurement_po_line_id', true), '');
  v_queue := coalesce(nullif(current_setting('warehouse.procurement_po_line_queue', true), '')::jsonb, '[]'::jsonb);
  if v_line_id is null and jsonb_typeof(v_queue)='array' and jsonb_array_length(v_queue)>0 then
    v_queue_line := v_queue->0;
    if v_queue_line->>'product_id' <> new.product_id
       or (v_queue_line->>'quantity')::numeric <> new.quantity then
      raise exception 'Receipt QC does not match the ordered procurement PO-line queue';
    end if;
    v_line_id := nullif(v_queue_line->>'line_id', '');
    perform set_config('warehouse.procurement_po_line_queue', (v_queue - 0)::text, true);
  end if;
  if v_line_id is null then
    select min(line->>'procurementLineId') into v_line_id
      from warehouse.receipts receipt
      cross join lateral jsonb_array_elements(receipt.lines) line
     where receipt.id=new.source_id and line->>'productId'=new.product_id
    having count(distinct line->>'procurementLineId') = 1;
  end if;
  new.procurement_po_line_id := v_line_id;
  return new;
end;
$$;

drop trigger if exists warehouse_quality_procurement_line on warehouse.quality_inspections;
create trigger warehouse_quality_procurement_line
before insert on warehouse.quality_inspections for each row
execute function private.bind_quality_procurement_line();

create or replace function warehouse.inspect_quality(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare v_line_id text;
begin
  v_line_id := nullif(payload->>'procurement_po_line_id', '');
  if v_line_id is null and payload->>'source_type'='receipt' then
    select quality.procurement_po_line_id into v_line_id
      from warehouse.quality_inspections quality
     where quality.source_type='receipt' and quality.source_id=payload->>'source_id'
       and quality.product_id=payload->>'product_id' and quality.disposition='pending'
       and quality.procurement_po_line_id is not null
     order by quality.inspected_at, quality.id limit 1;
  end if;
  perform set_config('warehouse.procurement_po_line_id', coalesce(v_line_id, ''), true);
  return private.warehouse_inspect_quality(payload);
end;
$$;
revoke all on function warehouse.inspect_quality(jsonb) from public, anon;
grant execute on function warehouse.inspect_quality(jsonb) to authenticated, service_role;

create or replace function private.procurement_po_receipt_status()
returns table (
  purchase_order_id text,
  ordered_quantity numeric,
  accepted_quantity numeric,
  rejected_or_quarantined_quantity numeric,
  outstanding_quantity numeric,
  latest_warehouse_receipt_reference text,
  qc_status text,
  last_received_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with receipt_lines as (
    select
      receipt.procurement_po_id as po_id,
      receipt.id as receipt_id,
      receipt.created_at,
      receipt.quality_status,
      line->>'procurementLineId' as procurement_po_line_id,
      coalesce((line->>'quantity')::numeric, 0) as quantity
    from warehouse.receipts receipt
    cross join lateral jsonb_array_elements(receipt.lines) line
    join procurement.purchase_order_lines po_line
      on po_line.id = line->>'procurementLineId'
     and po_line.purchase_order_id = receipt.procurement_po_id
     and po_line.receiving_status = 'open'
    where receipt.procurement_po_id is not null
  ), dispositions as (
    select
      receipt_line.*,
      coalesce(inspection.disposition, receipt_line.quality_status, 'pending') as disposition
    from receipt_lines receipt_line
    left join lateral (
      select quality.disposition
      from warehouse.quality_inspections quality
      where quality.source_type = 'receipt'
        and quality.source_id = receipt_line.receipt_id
        and quality.procurement_po_line_id = receipt_line.procurement_po_line_id
      order by quality.inspected_at desc, quality.id desc
      limit 1
    ) inspection on true
  ), totals as (
    select
      po_id,
      sum(quantity) filter (where disposition = 'accepted') as accepted_quantity,
      sum(quantity) filter (where disposition in ('damaged', 'hold', 'vendor_return', 'unavailable'))
        as rejected_quantity,
      max(created_at) as last_received_at
    from dispositions
    group by po_id
  )
  select
    po.id,
    coalesce(lines.ordered_quantity, 0),
    coalesce(totals.accepted_quantity, 0),
    coalesce(totals.rejected_quantity, 0),
    greatest(
      coalesce(lines.ordered_quantity, 0)
        - coalesce(totals.accepted_quantity, 0),
      0
    ) as outstanding_quantity,
    latest.receipt_id,
    case
      when coalesce(totals.rejected_quantity, 0) > 0 then 'exception'
      when coalesce(totals.accepted_quantity, 0) >= coalesce(lines.ordered_quantity, 0)
        and coalesce(lines.ordered_quantity, 0) > 0 then 'accepted'
      when coalesce(totals.accepted_quantity, 0) > 0 then 'partial'
      else 'not_received'
    end,
    totals.last_received_at
  from procurement.purchase_orders po
  left join lateral (
    select sum(line.quantity) as ordered_quantity
    from procurement.purchase_order_lines line
    where line.purchase_order_id = po.id
      and line.receiving_status = 'open'
  ) lines on true
  left join totals on totals.po_id = po.id
  left join lateral (
    select receipt.id as receipt_id
    from warehouse.receipts receipt
    where receipt.procurement_po_id = po.id::text
    order by receipt.created_at desc, receipt.id desc
    limit 1
  ) latest on true
  where core.has_cap('procurement', 'view_dashboard')
     or core.has_cap('procurement', 'author_po')
     or core.has_cap('warehouse', 'receive_stock');
$$;

revoke all on function private.procurement_po_receipt_status()
  from public, anon;
grant execute on function private.procurement_po_receipt_status()
  to authenticated, service_role;

create or replace view procurement.v_purchase_order_receipt_status
with (security_invoker = true)
as
select * from private.procurement_po_receipt_status();

revoke all on procurement.v_purchase_order_receipt_status from public, anon;
grant select on procurement.v_purchase_order_receipt_status
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Database-authoritative commitment evidence and readiness
-- ---------------------------------------------------------------------------

create table if not exists procurement.policy_evidence (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references procurement.requests(id) on delete restrict,
  control_code text not null,
  evidence_type text not null,
  facts jsonb not null default '{}'::jsonb,
  review_status text not null default 'submitted',
  reviewed_by uuid references core.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint procurement_policy_evidence_review_check check (
    review_status in ('submitted', 'approved', 'rejected', 'expired', 'superseded')
  )
);

create index if not exists procurement_policy_evidence_request_idx
  on procurement.policy_evidence(request_id, control_code, review_status, created_at desc);

alter table procurement.policy_evidence enable row level security;
alter table procurement.policy_evidence force row level security;
drop policy if exists procurement_policy_evidence_read on procurement.policy_evidence;
create policy procurement_policy_evidence_read on procurement.policy_evidence
  for select to authenticated
  using (core.has_cap('procurement', 'view_dashboard') or core.has_cap('procurement', 'author_po'));
revoke all on procurement.policy_evidence from public, anon, authenticated;
grant select on procurement.policy_evidence to authenticated;
grant all on procurement.policy_evidence to service_role;

create or replace function private.vendor_accreditation_readiness(
  p_vendor_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vendor core.vendors;
  v_request procurement.requests;
  v_case legal.accreditation_cases;
  v_snapshot legal.vendor_application_snapshots;
  v_required text[];
  v_code text;
  v_technology boolean := false;
  v_blockers jsonb := '[]'::jsonb;
begin
  select * into v_vendor from core.vendors where id = p_vendor_id;
  select * into v_request from procurement.requests where id = p_request_id;
  if v_vendor.id is null then return jsonb_build_array('selected vendor record'); end if;

  if exists (
    select 1
      from legal.accreditation_dispositions disposition
      join legal.accreditation_cases accreditation_case on accreditation_case.id = disposition.case_id
     where accreditation_case.vendor_id = p_vendor_id
       and disposition.disposition = 'temporary_clearance'
       and (disposition.conditions->>'approved')::boolean is true
       and coalesce((disposition.conditions->>'valid_from')::timestamptz, disposition.decided_at) <= now()
       and coalesce((disposition.conditions->>'valid_until')::timestamptz, disposition.follow_up_due_at) > now()
       and (disposition.conditions->>'request_id' is null or disposition.conditions->>'request_id' = p_request_id)
       and (disposition.conditions->>'category' is null or disposition.conditions->>'category' = v_request.category)
       and (disposition.conditions->>'max_amount' is null
         or coalesce(v_request.estimated_amount, 0) <= (disposition.conditions->>'max_amount')::numeric)
  ) then
    return v_blockers;
  end if;

  if v_vendor.accreditation_status <> 'approved'
     or (v_vendor.accreditation_expires_at is not null and v_vendor.accreditation_expires_at < current_date) then
    v_blockers := v_blockers || jsonb_build_array('current full accreditation or approved scoped temporary clearance');
    return v_blockers;
  end if;

  select * into v_case
    from legal.accreditation_cases
   where vendor_id = p_vendor_id and status = 'approved'
     and (expires_at is null or expires_at >= current_date)
   order by decided_at desc nulls last, created_at desc
   limit 1;
  if v_case.id is null then
    return v_blockers || jsonb_build_array('approved LGL004 accreditation case');
  end if;

  select * into v_snapshot
    from legal.vendor_application_snapshots
   where case_id = v_case.id and status = 'submitted' and policy_version = '2025'
   order by submitted_at desc nulls last, created_at desc
   limit 1;
  if v_snapshot.id is null then
    v_blockers := v_blockers || jsonb_build_array('signed Vendor Accreditation Form V2025 snapshot');
  end if;
  if v_case.entity_type not in ('sole_prop', 'partnership', 'corporation') then
    return v_blockers || jsonb_build_array('supported LGL004 entity type');
  end if;

  v_required := case v_case.entity_type
    when 'sole_prop' then array['PH_DTI_REG','PH_BIR_2303','PH_MAYORS_PERMIT','PH_CLIENT_LIST']
    when 'partnership' then array['PH_SEC_REG','PH_PARTNERSHIP_ARTICLES','PH_BIR_2303','PH_PARTNERSHIP_RESOLUTION','PH_MAYORS_PERMIT','PH_CLIENT_LIST']
    else array['PH_SEC_REG_ARTICLES_BYLAWS','PH_BIR_2303','PH_SECRETARY_CERT','PH_GIS','PH_MAYORS_PERMIT','PH_EXPERTISE_CERTS','PH_CLIENT_PORTFOLIO']
  end;
  v_required := v_required || array['PH_AFS_3Y','PH_COMPANY_PROFILE','PH_BANK_PROOF','PH_OFFICIAL_RECEIPT','SIGN_NDA'];
  if v_case.handles_personal_data then v_required := v_required || 'PH_PRIVACY_COMPLIANCE'; end if;
  v_technology := coalesce((v_snapshot.payload->>'technologyServiceProvider')::boolean, false)
    or coalesce((v_request.compliance#>>'{riskFacts,technologyServiceProvider}')::boolean, false)
    or coalesce((v_request.compliance#>>'{risk_facts,technology_service_provider}')::boolean, false);
  if v_technology then v_required := v_required || 'PH_CYBERSECURITY_POLICIES'; end if;

  foreach v_code in array v_required loop
    if not exists (
      select 1
        from legal.requirement_checklist_items item
       where item.case_id = v_case.id and item.code = v_code and item.required
         and item.decision in ('approved', 'na')
    ) and not (
      coalesce(v_case.jurisdiction, 'PH') <> 'PH' and exists (
        select 1 from legal.accreditation_dispositions disposition
         where disposition.case_id = v_case.id and disposition.requirement_code = v_code
           and disposition.disposition in ('foreign_equivalent', 'not_applicable')
      )
    ) then
      v_blockers := v_blockers || jsonb_build_array('approved accreditation requirement ' || v_code);
    end if;
  end loop;

  if v_technology and (
    jsonb_array_length(coalesce(v_snapshot.payload->'technologyQualifications','[]'::jsonb)) = 0
    or exists (
      select 1 from jsonb_array_elements(coalesce(v_snapshot.payload->'technologyQualifications','[]'::jsonb)) qualification
       where not exists (
         select 1 from legal.vendor_technology_qualifications reviewed
          where reviewed.application_snapshot_id=v_snapshot.id
            and reviewed.pool=qualification->>'pool' and reviewed.qualified
            and reviewed.reviewed_by is not null and reviewed.reviewed_at is not null
       )
    )
  ) then
    v_blockers := v_blockers || jsonb_build_array('reviewed V2025 technology qualification pools');
  end if;

  if v_technology and not exists (
    select 1
      from legal.instrument_documents document
     where document.case_id = v_case.id
       and document.template_version like 'mnda-tech-service-provider-%'
       and document.status = 'executed'
       and document.executed_at is not null
       and now() < least(
         document.executed_at + interval '2 years',
         coalesce(document.definitive_agreement_executed_at, 'infinity'::timestamptz)
       )
       and (select count(*) from legal.instrument_signatures signature
             where signature.instrument_document_id = document.id and signature.revoked_at is null) = 2
  ) then
    v_blockers := v_blockers || jsonb_build_array('current fully executed technology MNDA');
  end if;
  return v_blockers;
end;
$$;

create or replace function private.procurement_commitment_readiness(
  p_request_id text,
  p_vendor_id uuid default null,
  p_phase text default 'issue'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request procurement.requests;
  v_route procurement.route_decisions;
  v_pack procurement.exception_packs;
  v_blockers jsonb := '[]'::jsonb;
  v_context jsonb := '{}'::jsonb;
  v_required_code text;
  v_required_codes text[] := '{}';
begin
  select * into v_request from procurement.requests where id = p_request_id;
  if v_request.id is null then return jsonb_build_object('ready', false, 'blockers', jsonb_build_array('procurement request')); end if;
  select * into v_route from procurement.route_decisions
   where request_id = p_request_id and status = 'confirmed'
   order by request_version desc limit 1;
  if v_route.id is null then
    v_blockers := v_blockers || jsonb_build_array('Procurement-confirmed sourcing route');
  else
    v_context := coalesce(v_request.compliance, '{}'::jsonb) || coalesce(v_route.risk_facts, '{}'::jsonb);
    if v_route.method = 'rfq' then
      v_required_codes := array['RFQ_COMMERCIAL_COMPARISON'];
    elsif v_route.method = 'rfp' then
      v_required_codes := array['RFP_TECHNICAL_EVALUATION','RFP_COMMERCIAL_EVALUATION','RFP_AWARD_RECOMMENDATION'];
    end if;
    if v_route.method in ('rfq', 'rfp') and not exists (
      select 1 from procurement.sourcing_events event
       where event.request_id = p_request_id and event.route_decision_id = v_route.id
         and event.status in ('issued', 'closed') and exists (
           select 1 from procurement.sourcing_responses response
            where response.sourcing_event_id = event.id and response.received_at is not null
         )
    ) then
      v_blockers := v_blockers || jsonb_build_array('documented ' || upper(v_route.method) || ' sourcing event and received response');
    end if;
    foreach v_required_code in array v_required_codes loop
      if not exists (
        select 1 from procurement.policy_evidence evidence
         where evidence.request_id = p_request_id and evidence.control_code = v_required_code
           and evidence.review_status = 'approved'
           and (evidence.expires_at is null or evidence.expires_at > now())
      ) then v_blockers := v_blockers || jsonb_build_array('approved policy evidence ' || v_required_code); end if;
    end loop;
  end if;

  if v_route.method in ('direct_award','repeat_order','emergency','petty_cash') then
    select * into v_pack from procurement.exception_packs
     where request_id = p_request_id and status = 'approved'
     order by created_at desc limit 1;
    if v_pack.id is null then
      v_blockers := v_blockers || jsonb_build_array('approved exception pack');
    elsif v_route.method = 'direct_award' then
      if v_pack.exception_type not in ('direct_award','sole_supplier')
         or v_pack.vendor_id is null
         or nullif(btrim(v_pack.justification), '') is null
         or nullif(btrim(v_pack.price_reasonableness), '') is null
         or nullif(v_pack.evidence->>'allowed_basis', '') is null
         or nullif(v_pack.evidence->>'requested_vendor', '') is null
         or nullif(v_pack.evidence->>'price_support', '') is null
         or nullif(v_pack.accreditation_state, '') is null
         or v_pack.procurement_head_reviewed_by is null
         or v_pack.procurement_head_reviewed_at is null then
        v_blockers := v_blockers || jsonb_build_array('complete Direct Award pack and Procurement Head review');
      end if;
      if p_phase <> 'submit' and (v_pack.final_approval_step_id is null or not exists (
        select 1 from procurement.approval_steps step
         where step.id = v_pack.final_approval_step_id and step.request_id = p_request_id and step.status = 'approved'
      )) then v_blockers := v_blockers || jsonb_build_array('final DOA approval for Direct Award'); end if;
    elsif v_route.method = 'petty_cash' and (
      v_pack.exception_type <> 'petty_cash_non_accredited'
      or not coalesce(v_pack.finance_eligibility_confirmed, false)
      or not coalesce(v_pack.non_recurring_non_split_attested, false)
      or nullif(btrim(v_pack.justification), '') is null
    ) then v_blockers := v_blockers || jsonb_build_array('Finance-approved one-time non-split petty-cash exception'); end if;
  end if;

  if p_vendor_id is not null and not (
    v_route.method = 'petty_cash' and v_pack.exception_type = 'petty_cash_non_accredited'
      and coalesce(v_pack.finance_eligibility_confirmed, false)
      and coalesce(v_pack.non_recurring_non_split_attested, false)
  ) then
    v_blockers := v_blockers || private.vendor_accreditation_readiness(p_vendor_id, p_request_id);
  elsif p_phase <> 'submit' and p_vendor_id is null then
    v_blockers := v_blockers || jsonb_build_array('selected vendor');
  end if;

  if coalesce((v_context->>'importation')::boolean, false)
     or coalesce((v_context->>'foreignVendor')::boolean, false)
     or exists (
       select 1 from legal.accreditation_cases accreditation_case
        where accreditation_case.vendor_id=p_vendor_id
          and coalesce(accreditation_case.jurisdiction,'PH') <> 'PH'
     ) then
    if not exists (
      select 1 from procurement.policy_evidence evidence
       where evidence.request_id = p_request_id and evidence.control_code = 'IMPORT_PLAN'
         and evidence.review_status = 'approved'
         and evidence.facts ?& array['incoterms','importerOfRecord','permitsAndRegistrations','customsBrokerAndLogistics','dutiesTaxesFreightInsurance','foreignPaymentTiming','deliveryAcceptanceAndWarranty']
    ) then v_blockers := v_blockers || jsonb_build_array('approved complete importation plan'); end if;
  end if;

  if coalesce((v_context->>'downPayment')::boolean, false) and not exists (
    select 1 from procurement.financial_protection_requirements protection
     where protection.request_id = p_request_id and protection.protection_type = 'down_payment_bond'
       and protection.status = 'approved' and protection.reviewed_by is not null
       and coalesce(protection.required_amount, 0) >= coalesce((v_context->>'downPaymentAmount')::numeric, 0)
  ) then v_blockers := v_blockers || jsonb_build_array('approved down-payment bond equal to the down payment'); end if;
  if v_request.category = 'manpower' and not exists (
    select 1 from procurement.financial_protection_requirements protection
     where protection.request_id = p_request_id and protection.protection_type = 'payment_bond'
       and protection.status in ('approved','waived') and protection.reviewed_by is not null
  ) then v_blockers := v_blockers || jsonb_build_array('reviewed manpower payment-bond or equivalent protection'); end if;
  if v_request.category = 'construction' then
    foreach v_required_code in array array['performance_bond','warranty_bond','cari','eari'] loop
      if not exists (select 1 from procurement.financial_protection_requirements protection
        where protection.request_id = p_request_id and protection.protection_type = v_required_code
          and protection.status in ('approved','waived') and protection.reviewed_by is not null)
      then v_blockers := v_blockers || jsonb_build_array('approved construction protection ' || v_required_code); end if;
    end loop;
    if coalesce((v_context->>'pcabRequired')::boolean, false) and not exists (
      select 1 from procurement.policy_evidence evidence where evidence.request_id=p_request_id
        and evidence.control_code='PCAB_LICENSE' and evidence.review_status='approved'
    ) then v_blockers := v_blockers || jsonb_build_array('applicable approved PCAB evidence'); end if;
  end if;
  if coalesce((v_context->>'equipmentInstallation')::boolean, false) and not exists (
    select 1 from procurement.policy_evidence evidence where evidence.request_id=p_request_id
      and evidence.control_code='INSTALLATION_PROTECTIONS' and evidence.review_status='approved'
  ) then v_blockers := v_blockers || jsonb_build_array('approved installation commissioning, defects, warranty, acceptance, and risk protections'); end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'phase', p_phase,
    'request_id', p_request_id,
    'vendor_id', p_vendor_id,
    'route', v_route.method,
    'blockers', v_blockers,
    'evidence', coalesce((select jsonb_agg(jsonb_build_object(
      'controlCode', evidence.control_code, 'evidenceType', evidence.evidence_type,
      'reviewStatus', evidence.review_status, 'reviewedAt', evidence.reviewed_at,
      'expiresAt', evidence.expires_at, 'facts', evidence.facts
    ) order by evidence.created_at) from procurement.policy_evidence evidence
      where evidence.request_id = p_request_id and evidence.review_status <> 'superseded'), '[]'::jsonb)
  );
end;
$$;

create or replace function procurement.commitment_readiness(payload jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not core.has_cap('procurement','view_dashboard')
     and not core.has_cap('procurement','author_po')
     and not core.has_cap('procurement','approve_award') then
    raise exception 'Not authorized to view commitment readiness';
  end if;
  return private.procurement_commitment_readiness(
    payload->>'request_id', nullif(payload->>'vendor_id','')::uuid,
    coalesce(nullif(payload->>'phase',''), 'issue')
  );
end;
$$;

revoke all on function private.vendor_accreditation_readiness(uuid,text) from public, anon;
revoke all on function private.procurement_commitment_readiness(text,uuid,text) from public, anon;
revoke all on function procurement.commitment_readiness(jsonb) from public, anon;
grant execute on function private.vendor_accreditation_readiness(uuid,text) to authenticated, service_role;
grant execute on function private.procurement_commitment_readiness(text,uuid,text) to authenticated, service_role;
grant execute on function procurement.commitment_readiness(jsonb) to authenticated, service_role;

create or replace view procurement.v_purchase_order_commitment_readiness
with (security_invoker = true)
as
select
  purchase_order.id as purchase_order_id,
  private.procurement_commitment_readiness(
    purchase_order.request_id,
    purchase_order.core_vendor_id,
    case when purchase_order.status in ('draft','pending_approval') then 'approve' else 'issue' end
  ) as readiness
from procurement.purchase_orders purchase_order
where purchase_order.request_id is not null;

revoke all on procurement.v_purchase_order_commitment_readiness from public, anon;
grant select on procurement.v_purchase_order_commitment_readiness to authenticated, service_role;

do $$
begin
  if to_regprocedure('private.policy_submit_procurement_request_legacy(jsonb)') is null then
    alter function private.policy_submit_procurement_request(jsonb)
      rename to policy_submit_procurement_request_legacy;
  end if;
  if to_regprocedure('private.policy_approve_purchase_order_legacy(jsonb)') is null then
    alter function private.policy_approve_purchase_order(jsonb)
      rename to policy_approve_purchase_order_legacy;
  end if;
  if to_regprocedure('private.policy_issue_purchase_order_legacy(jsonb)') is null then
    alter function private.policy_issue_purchase_order(jsonb)
      rename to policy_issue_purchase_order_legacy;
  end if;
end
$$;

create or replace function private.policy_submit_procurement_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request procurement.requests;
  v_route procurement.route_decisions;
  v_required_tiers text[];
  v_readiness jsonb;
  v_result jsonb;
begin
  select * into v_request from procurement.requests where id=payload->>'id' for update;
  if v_request.id is null then raise exception 'Request not found'; end if;
  select * into v_route
  from procurement.route_decisions
  where request_id=v_request.id and status='confirmed'
  order by request_version desc, confirmed_at desc
  limit 1;
  if v_route.id is null then
    raise exception 'policy_decision_required: Procurement-confirmed sourcing route';
  end if;
  v_required_tiers := procurement.derive_approval_tiers(
    v_request.category,
    coalesce(v_request.estimated_amount, 0),
    v_route.method
  );
  if coalesce(cardinality(v_required_tiers), 0) = 0 then
    raise exception 'policy_decision_required: determinate approval ladder';
  end if;
  v_readiness := private.procurement_commitment_readiness(v_request.id, v_request.core_vendor_id, 'submit');
  if not (v_readiness->>'ready')::boolean then
    raise exception 'commitment_blocked: %', v_readiness->'blockers';
  end if;
  v_result := private.policy_submit_procurement_request_legacy(payload);
  return v_result || jsonb_build_object('commitment_readiness', v_readiness);
end;
$$;

create or replace function private.policy_approve_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po procurement.purchase_orders;
  v_request procurement.requests;
  v_readiness jsonb;
  v_result jsonb;
begin
  select * into v_po from procurement.purchase_orders where id=payload->>'id' for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  select * into v_request from procurement.requests where id=v_po.request_id for update;
  v_readiness := private.procurement_commitment_readiness(v_po.request_id, v_po.core_vendor_id, 'approve');
  if not (v_readiness->>'ready')::boolean then
    raise exception 'commitment_blocked: %', v_readiness->'blockers';
  end if;
  v_result := private.policy_approve_purchase_order_legacy(payload);
  return v_result || jsonb_build_object('commitment_readiness', v_readiness);
end;
$$;

create or replace function private.policy_issue_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po procurement.purchase_orders;
  v_request procurement.requests;
  v_readiness jsonb;
  v_result jsonb;
begin
  select * into v_po from procurement.purchase_orders where id=payload->>'id' for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  select * into v_request from procurement.requests where id=v_po.request_id for update;
  v_readiness := private.procurement_commitment_readiness(v_po.request_id, v_po.core_vendor_id, 'issue');
  if not (v_readiness->>'ready')::boolean then
    raise exception 'commitment_blocked: %', v_readiness->'blockers';
  end if;
  v_result := private.policy_issue_purchase_order_legacy(payload);
  return v_result || jsonb_build_object('commitment_readiness', v_readiness);
end;
$$;

create or replace function private.policy_assert_po_vendor_eligible(p_vendor_id uuid, p_request_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_readiness jsonb;
begin
  v_readiness := private.procurement_commitment_readiness(p_request_id, p_vendor_id, 'issue');
  if not (v_readiness->>'ready')::boolean then
    raise exception 'commitment_blocked: %', v_readiness->'blockers';
  end if;
end;
$$;

revoke all on function private.policy_submit_procurement_request_legacy(jsonb) from public, anon, authenticated;
revoke all on function private.policy_approve_purchase_order_legacy(jsonb) from public, anon, authenticated;
revoke all on function private.policy_issue_purchase_order_legacy(jsonb) from public, anon, authenticated;
revoke all on function private.policy_submit_procurement_request(jsonb) from public, anon;
revoke all on function private.policy_approve_purchase_order(jsonb) from public, anon;
revoke all on function private.policy_issue_purchase_order(jsonb) from public, anon;
grant execute on function private.policy_submit_procurement_request(jsonb) to authenticated, service_role;
grant execute on function private.policy_approve_purchase_order(jsonb) to authenticated, service_role;
grant execute on function private.policy_issue_purchase_order(jsonb) to authenticated, service_role;

-- The Procurement receipt table was a stale writable projection. Warehouse
-- receipts and line-bound QC are the only goods-acceptance source of truth.
drop table if exists procurement.receipts cascade;

create or replace function private.policy_record_acceptance_pack(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po procurement.purchase_orders;
  v_pack procurement.acceptance_packs;
  v_scope jsonb := payload->'accepted_scope';
  v_scope_line jsonb;
  v_acceptance_type text;
  v_requested numeric;
  v_accepted numeric;
  v_hash text;
begin
  select * into v_po from procurement.purchase_orders
   where id=payload->>'purchase_order_id' for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  if not core.has_module_role('warehouse')
     and auth.uid() <> (select requester_id from procurement.requests where id=v_po.request_id) then
    raise exception 'Not authorized to record acceptance';
  end if;
  v_acceptance_type := case payload->>'acceptance_type'
    when 'goods' then 'goods_receipt'
    when 'service' then 'service_completion'
    when 'milestone' then 'technical_acceptance'
    else payload->>'acceptance_type'
  end;
  if v_acceptance_type = 'goods_receipt' then
    if nullif(payload->>'warehouse_receipt_reference','') is null or not exists (
      select 1 from warehouse.receipts receipt
       where receipt.id=payload->>'warehouse_receipt_reference'
         and receipt.procurement_po_id=v_po.id
    ) then raise exception 'A governed Warehouse receipt is required for goods acceptance'; end if;
    if jsonb_typeof(v_scope) <> 'object' or jsonb_typeof(v_scope->'lines') <> 'array'
       or jsonb_array_length(v_scope->'lines') = 0 then
      raise exception 'Goods acceptance requires PO-line quantities';
    end if;
    for v_scope_line in select value from jsonb_array_elements(v_scope->'lines') loop
      begin v_requested := (v_scope_line->>'quantity')::numeric;
      exception when others then raise exception 'Accepted quantity must be positive'; end;
      if v_requested <= 0 then raise exception 'Accepted quantity must be positive'; end if;
      if not exists (
        select 1 from procurement.purchase_order_lines line
         where line.id=v_scope_line->>'poLineId' and line.purchase_order_id=v_po.id
           and line.receiving_status='open'
      ) then raise exception 'Accepted scope contains an invalid or closed PO line'; end if;
      select coalesce(sum(quality.quantity),0) into v_accepted
        from warehouse.quality_inspections quality
        join warehouse.receipts receipt on receipt.id=quality.source_id
       where quality.source_type='receipt' and receipt.procurement_po_id=v_po.id
         and quality.procurement_po_line_id=v_scope_line->>'poLineId'
         and quality.disposition='accepted';
      if v_requested > v_accepted then
        raise exception 'Accepted scope exceeds Warehouse QC-accepted quantity for PO line %', v_scope_line->>'poLineId';
      end if;
    end loop;
  elsif jsonb_typeof(v_scope) = 'string' then
    v_scope := jsonb_build_object('summary', payload->>'accepted_scope');
  end if;
  if v_scope is null or v_scope = '{}'::jsonb then raise exception 'Accepted scope is required'; end if;
  v_hash := encode(digest(convert_to(v_scope::text,'UTF8'),'sha256'),'hex');
  update procurement.acceptance_packs set status='superseded'
   where purchase_order_id=v_po.id and status in ('accepted','accepted_with_exceptions');
  insert into procurement.acceptance_packs(
    purchase_order_id,request_id,warehouse_receipt_reference,acceptance_type,
    accepted_scope,exceptions,accepted_by,document_hash,status
  ) values (
    v_po.id,v_po.request_id,payload->>'warehouse_receipt_reference',v_acceptance_type,
    v_scope,coalesce(payload->'exceptions','[]'::jsonb),auth.uid(),v_hash,
    case when jsonb_array_length(coalesce(payload->'exceptions','[]'::jsonb))>0
      then 'accepted_with_exceptions' else 'accepted' end
  ) returning * into v_pack;
  return to_jsonb(v_pack);
end;
$$;

create or replace function procurement.record_acceptance_pack(payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.policy_record_acceptance_pack(payload) $$;
revoke all on function private.policy_record_acceptance_pack(jsonb) from public, anon;
revoke all on function procurement.record_acceptance_pack(jsonb) from public, anon;
grant execute on function private.policy_record_acceptance_pack(jsonb) to authenticated, service_role;
grant execute on function procurement.record_acceptance_pack(jsonb) to authenticated, service_role;

do $$
begin
  if to_regprocedure('private.policy_prepare_payment_readiness_legacy(jsonb)') is null then
    alter function private.policy_prepare_payment_readiness(jsonb)
      rename to policy_prepare_payment_readiness_legacy;
  end if;
end
$$;

create or replace function private.policy_prepare_payment_readiness(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po procurement.purchase_orders;
  v_route procurement.route_decisions;
  v_result jsonb;
begin
  select * into v_po from procurement.purchase_orders
   where id=payload->>'purchase_order_id' for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  select * into v_route from procurement.route_decisions
   where request_id=v_po.request_id and status='confirmed'
   order by request_version desc limit 1;
  if v_route.method='petty_cash' and (
    nullif(payload->>'invoice_or_si_storage_path','') is null
    or not exists (
      select 1 from procurement.policy_evidence evidence
       where evidence.request_id=v_po.request_id
         and evidence.control_code='PETTY_CASH_LIQUIDATION'
         and evidence.review_status='approved'
    )
  ) then
    raise exception 'Petty-cash payment requires OR/SI and approved liquidation evidence';
  end if;
  v_result := private.policy_prepare_payment_readiness_legacy(payload);
  return v_result;
end;
$$;

revoke all on function private.policy_prepare_payment_readiness_legacy(jsonb) from public, anon, authenticated;
revoke all on function private.policy_prepare_payment_readiness(jsonb) from public, anon;
grant execute on function private.policy_prepare_payment_readiness(jsonb) to authenticated, service_role;

create or replace function private.enforce_technology_mnda_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_trigger_at timestamptz;
begin
  if new.template_version not like 'mnda-tech-service-provider-%' then return new; end if;
  if new.executed_at is not null then
    new.expires_at := least(
      new.executed_at + interval '2 years',
      coalesce(new.definitive_agreement_executed_at, 'infinity'::timestamptz)
    );
  end if;
  return new;
end;
$$;

create or replace function private.add_business_days(p_started_at timestamptz, p_days integer)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare v_due timestamptz := p_started_at; v_remaining integer := p_days;
begin
  while v_remaining > 0 loop
    v_due := v_due + interval '1 day';
    if extract(isodow from v_due) < 6 then v_remaining := v_remaining - 1; end if;
  end loop;
  return v_due;
end;
$$;

create or replace function private.record_technology_mnda_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_trigger_at timestamptz;
begin
  if new.template_version not like 'mnda-tech-service-provider-%' then return new; end if;
  v_trigger_at := case
    when new.definitive_agreement_executed_at is distinct from old.definitive_agreement_executed_at
      then new.definitive_agreement_executed_at
    when new.status in ('expired','terminated') and new.status is distinct from old.status then now()
    else null
  end;
  if v_trigger_at is not null and not exists (
    select 1 from legal.instrument_lifecycle_events event
     where event.instrument_document_id=new.id and event.event_type='return_or_destroy_requested'
       and event.occurred_at=v_trigger_at
  ) then
    insert into legal.instrument_lifecycle_events(
      instrument_document_id,document_hash,event_type,occurred_at,due_at,retention_basis,actor_id
    ) values (
      new.id,new.document_hash,'return_or_destroy_requested',v_trigger_at,
      private.add_business_days(v_trigger_at, 5),'MNDA five-business-day return or destruction obligation',
      coalesce(auth.uid(), new.created_by)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists legal_technology_mnda_expiry on legal.instrument_documents;
create trigger legal_technology_mnda_expiry
before insert or update of executed_at, definitive_agreement_executed_at
on legal.instrument_documents for each row execute function private.enforce_technology_mnda_lifecycle();
drop trigger if exists legal_technology_mnda_lifecycle on legal.instrument_documents;
create trigger legal_technology_mnda_lifecycle
after update of status, definitive_agreement_executed_at
on legal.instrument_documents for each row execute function private.record_technology_mnda_lifecycle();
