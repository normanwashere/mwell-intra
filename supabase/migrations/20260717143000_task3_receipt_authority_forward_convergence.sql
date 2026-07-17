-- Forward convergence for databases that already applied the original receipt-authority migration.
-- Statements remain idempotent so clean installs can apply this after the source migration.

alter table procurement.purchase_order_amendments
  add column if not exists doa_matrix_id uuid references procurement.doa_matrices(id) on delete restrict,
  add column if not exists doa_matrix_version text,
  add column if not exists effective_at timestamptz,
  add column if not exists department text,
  add column if not exists category text,
  add column if not exists before_commitment_version integer,
  add column if not exists after_commitment_version integer,
  add column if not exists before_commitment jsonb,
  add column if not exists after_commitment jsonb,
  add column if not exists decision text,
  add column if not exists decided_by uuid references core.profiles(id) on delete restrict,
  add column if not exists decided_at timestamptz;

alter table procurement.purchase_order_amendments
  drop constraint if exists purchase_order_amendments_status_check;
alter table procurement.purchase_order_amendments
  add constraint purchase_order_amendments_status_check
  check (status in ('requested','under_review','approved','rejected','superseded'));

alter table procurement.purchase_order_amendments
  add column if not exists legacy_record boolean;
update procurement.purchase_order_amendments
set legacy_record=true
where legacy_record is null;
update procurement.purchase_order_amendments
set status='superseded',
    decision='superseded',
    decision_reason=concat_ws(' ',nullif(decision_reason,''),
      'Superseded during governed-snapshot migration; submit a new amendment through the current DOA workflow.'),
    decided_at=coalesce(decided_at,current_timestamp)
where legacy_record
  and status in ('requested','under_review','approved');
alter table procurement.purchase_order_amendments
  alter column legacy_record set default false,
  alter column legacy_record set not null;
alter table procurement.purchase_order_amendments
  drop constraint if exists purchase_order_amendments_governed_snapshot_check;
alter table procurement.purchase_order_amendments
  add constraint purchase_order_amendments_governed_snapshot_check check (
    legacy_record or (
      doa_matrix_id is not null
      and nullif(doa_matrix_version,'') is not null
      and effective_at is not null
      and nullif(department,'') is not null
      and before_commitment_version is not null
      and after_commitment_version is not null
      and before_commitment is not null
      and after_commitment is not null
    )
  );
alter table procurement.purchase_order_amendments
  drop constraint if exists purchase_order_amendments_legacy_terminal_check;
alter table procurement.purchase_order_amendments
  add constraint purchase_order_amendments_legacy_terminal_check check (
    not legacy_record or status in ('rejected','superseded')
  );

alter table procurement.purchase_orders
  add column if not exists commitment_version integer not null default 1;

create table if not exists procurement.purchase_order_amendment_steps (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references procurement.purchase_order_amendments(id) on delete restrict,
  step_order integer not null check (step_order>0),
  tier text not null,
  assigned_user_id uuid not null references core.profiles(id) on delete restrict,
  doa_assignment_id uuid not null references procurement.doa_assignments(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','approved','rejected','skipped')),
  decision_reason text,
  signature jsonb,
  decided_by uuid references core.profiles(id) on delete restrict,
  decided_at timestamptz,
  unique(amendment_id,step_order)
);
alter table procurement.purchase_order_amendment_steps enable row level security;
alter table procurement.purchase_order_amendment_steps force row level security;
revoke all on procurement.purchase_order_amendment_steps from public,anon,authenticated;
grant all on procurement.purchase_order_amendment_steps to service_role;

create or replace function private.guard_po_amendment_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.purchase_order_id is distinct from new.purchase_order_id
     or old.po_line_id is distinct from new.po_line_id
     or old.previous_quantity is distinct from new.previous_quantity
     or old.amended_quantity is distinct from new.amended_quantity
     or old.legacy_record is distinct from new.legacy_record
     or old.doa_matrix_id is distinct from new.doa_matrix_id
     or old.before_commitment_version is distinct from new.before_commitment_version
     or old.after_commitment_version is distinct from new.after_commitment_version
     or old.before_commitment is distinct from new.before_commitment
     or old.after_commitment is distinct from new.after_commitment then
    raise exception 'PO amendment commitment and DOA snapshots are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_po_amendment_snapshot on procurement.purchase_order_amendments;
create trigger guard_po_amendment_snapshot before update on procurement.purchase_order_amendments
for each row execute function private.guard_po_amendment_snapshot();

alter table warehouse.procurement_receipt_excess_custody
  add column if not exists approved_amendment_id uuid
    references procurement.purchase_order_amendments(id) on delete restrict;

create or replace function private.warehouse_resolve_procurement_receipt_excess(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_custody warehouse.procurement_receipt_excess_custody;
  v_decision warehouse.procurement_receipt_exception_decisions;
  v_receipt warehouse.receipts;
  v_po procurement.purchase_orders;
  v_line procurement.purchase_order_lines;
  v_product warehouse.products;
  v_amendment procurement.purchase_order_amendments;
  v_outcome text:=payload->>'outcome';
  v_reason text:=nullif(pg_catalog.btrim(coalesce(payload->>'reason','')),'');
  v_evidence jsonb:=coalesce(payload->'evidence_urls','[]'::jsonb);
  v_response jsonb;
begin
  v_started:=private.begin_idempotent_command(
    'resolve_procurement_receipt_excess',payload->>'idempotency_key',payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id:=(v_started->>'command_id')::uuid;
  if not core.has_cap('warehouse','resolve_exceptions')
     or not core.has_cap('warehouse','release_quality_hold') then
    raise exception 'Not authorized: governed excess receipt disposition';
  end if;
  if v_outcome not in ('accepted_amendment','vendor_return','written_off') then
    raise exception 'Excess custody requires amendment acceptance, vendor return, or final write-off';
  end if;
  if v_outcome in ('vendor_return','written_off')
     and not core.has_cap('warehouse','manage_returns') then
    raise exception 'Not authorized: warehouse.manage_returns';
  end if;
  if v_reason is null or jsonb_typeof(v_evidence)<>'array' or jsonb_array_length(v_evidence)=0 then
    raise exception 'Excess disposition reason and evidence are required';
  end if;
  select * into v_custody from warehouse.procurement_receipt_excess_custody
   where id=(payload->>'custody_id')::uuid and status in ('pending','held') for update;
  if not found then raise exception 'Actionable excess custody not found'; end if;
  select * into v_decision from warehouse.procurement_receipt_exception_decisions
   where id=v_custody.decision_id for update;
  if v_decision.requested_by=auth.uid() then
    raise exception 'The receiving Operator cannot resolve their own excess custody';
  end if;
  select * into v_receipt from warehouse.receipts where id=v_custody.receipt_id for update;
  select * into v_po from procurement.purchase_orders
   where id=v_decision.purchase_order_id for update;
  select * into v_line from procurement.purchase_order_lines
   where id=v_custody.po_line_id and purchase_order_id=v_po.id
     and receiving_status='open' for update;
  if not found then raise exception 'Excess custody PO line is no longer open'; end if;
  if v_custody.product_id is not null then
    perform private.lock_warehouse_products(array[v_custody.product_id]);
  end if;

  if v_outcome='accepted_amendment' then
    if v_custody.status<>'held' or v_decision.status<>'decided'
       or v_decision.decision<>'quarantine' then
      raise exception 'Accepted excess requires held custody after a decided quarantine';
    end if;
    if v_custody.product_id is null then
      raise exception 'Governed product identification is required before accepting excess custody';
    end if;
    select * into v_amendment from procurement.purchase_order_amendments amendment
     where amendment.id=nullif(payload->>'approved_amendment_id','')::uuid
       and amendment.purchase_order_id=v_po.id
       and amendment.po_line_id=v_line.id
       and amendment.status='approved' for share;
    if not found
       or v_amendment.previous_quantity<>v_custody.ordered_quantity
       or v_amendment.amended_quantity-v_amendment.previous_quantity<v_custody.excess_quantity
       or v_line.quantity<v_amendment.amended_quantity
       or v_line.quantity-v_line.received_quantity<v_custody.excess_quantity then
      raise exception 'An approved PO amendment must prove ordered quantity growth covering the full excess custody quantity';
    end if;
    select * into v_product from warehouse.products where id=v_custody.product_id for share;
    if v_product.serialized then
      raise exception 'Serialized excess requires identified governed unit disposition';
    end if;
    insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity)
    values(v_custody.product_id,v_receipt.location_id,null,null,v_custody.excess_quantity)
    on conflict(product_id,location_id,bin_id,lot_id) do update
      set quantity=warehouse.stock_levels.quantity+excluded.quantity;
    insert into warehouse.quality_inspections(
      source_type,source_id,product_id,location_id,quantity,disposition,reason,
      evidence_urls,inspected_by,inspected_by_email,procurement_po_line_id
    ) values (
      'receipt',v_receipt.id,v_custody.product_id,v_receipt.location_id,
      v_custody.excess_quantity,'accepted',v_reason,v_evidence,auth.uid(),
      coalesce(auth.jwt()->>'email',''),v_line.id
    );
    insert into warehouse.movements(
      id,type,product_id,quantity,to_location_id,reason,reference,evidence_urls,actor,created_at
    ) values (
      'mv-'||replace(gen_random_uuid()::text,'-',''),'receipt',v_custody.product_id,
      v_custody.excess_quantity,v_receipt.location_id,v_reason,v_receipt.id,v_evidence,
      coalesce(auth.jwt()->>'email',auth.uid()::text),now()
    );
    update procurement.purchase_order_lines
       set received_quantity=received_quantity+v_custody.excess_quantity
     where id=v_line.id
       and received_quantity+v_custody.excess_quantity<=quantity;
    if not found then raise exception 'Concurrent receipt changed the amended ordered balance'; end if;
  end if;

  if v_decision.status<>'decided' or v_decision.decision<>'quarantine' then
    raise exception 'Excess custody requires the Warehouse Supervisor to quarantine the parent receipt first';
  end if;
  if not exists (
    select 1 from warehouse.procurement_receipt_exception_lines claim
    where claim.decision_id=v_decision.id and claim.po_line_id=v_line.id and claim.active
  ) then
    raise exception 'Excess custody requires its locked active PO-line claim';
  end if;

  update warehouse.procurement_receipt_excess_custody set
    status=v_outcome,resolution_reason=v_reason,resolution_evidence_urls=v_evidence,
    approved_amendment_id=case when v_outcome='accepted_amendment' then v_amendment.id else null end,
    resolved_by=auth.uid(),resolved_at=now()
   where id=v_custody.id returning * into v_custody;
  perform private.release_procurement_receipt_line_claim(v_receipt.id,v_line.id);
  update warehouse.exceptions set status=case when exists (
    select 1 from warehouse.procurement_receipt_exception_lines claim
    where claim.decision_id=v_decision.id and claim.active
  ) then 'in_progress' else 'resolved' end,
    resolution=v_reason,evidence_urls=v_evidence,owner_id=auth.uid(),updated_at=now()
   where id=v_decision.exception_id;
  update procurement.purchase_orders set status=case when not exists (
    select 1 from procurement.purchase_order_lines open_line
     where open_line.purchase_order_id=v_po.id and open_line.receiving_status='open'
       and open_line.received_quantity<open_line.quantity
  ) and not exists (
    select 1 from warehouse.procurement_receipt_exception_lines active_line
    join warehouse.procurement_receipt_exception_decisions active_decision
      on active_decision.id=active_line.decision_id
    where active_line.active and active_decision.purchase_order_id=v_po.id
  ) then 'closed' else 'issued' end,updated_at=now()
   where id=v_po.id returning * into v_po;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('warehouse','receipt_excess_custody',v_custody.id,v_outcome,auth.uid(),
    jsonb_build_object('receipt_id',v_receipt.id,'po_line_id',v_line.id,
      'ordered_quantity',v_custody.ordered_quantity,'excess_quantity',v_custody.excess_quantity));
  v_response:=jsonb_build_object('custody',to_jsonb(v_custody),'purchase_order',to_jsonb(v_po));
  return private.finish_idempotent_command(v_command_id,v_response);
end;
$$;

create or replace function warehouse.resolve_procurement_receipt_excess(payload jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.warehouse_resolve_procurement_receipt_excess(payload)
$$;
revoke all on function private.warehouse_resolve_procurement_receipt_excess(jsonb)
  from public,anon,authenticated;
revoke all on function warehouse.resolve_procurement_receipt_excess(jsonb) from public,anon;
grant execute on function private.warehouse_resolve_procurement_receipt_excess(jsonb) to service_role;
grant execute on function warehouse.resolve_procurement_receipt_excess(jsonb) to authenticated,service_role;

revoke all on function private.warehouse_resolve_procurement_po_exception_v3(jsonb)
  from public,anon,authenticated;
revoke all on function private.warehouse_receipt_exception_work_items_v3(jsonb)
  from public,anon,authenticated;
revoke all on function private.guard_active_procurement_receipt_decision()
  from public,anon,authenticated;
grant execute on function private.warehouse_resolve_procurement_po_exception_v3(jsonb)
  to service_role;
grant execute on function private.warehouse_receipt_exception_work_items_v3(jsonb)
  to service_role;

-- Fifth-review convergence: exact excess custody, amendment proof, line-exact QC,
-- and versioned acceptance evidence.
create index if not exists procurement_po_amendments_line_idx
  on procurement.purchase_order_amendments(purchase_order_id,po_line_id,status,requested_at desc);
alter table procurement.purchase_order_amendments enable row level security;
alter table procurement.purchase_order_amendments force row level security;
revoke all on procurement.purchase_order_amendments from public,anon,authenticated;
grant select on procurement.purchase_order_amendments to authenticated;
grant all on procurement.purchase_order_amendments to service_role;

create or replace function private.policy_request_po_line_quantity_amendment(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_po procurement.purchase_orders;
  v_line procurement.purchase_order_lines;
  v_amendment procurement.purchase_order_amendments;
  v_request procurement.requests;
  v_matrix procurement.doa_matrices;
  v_required_tiers text[];
  v_after_total numeric;
  v_step_count integer;
  v_distinct_step_count integer;
  v_effective_at timestamptz:=current_timestamp;
  v_quantity numeric;
  v_reason text:=nullif(pg_catalog.btrim(coalesce(payload->>'reason','')),'');
  v_evidence jsonb:=coalesce(payload->'evidence_urls','[]'::jsonb);
begin
  if not core.has_cap('procurement','author_po') and not core.has_cap('procurement','admin') then
    raise exception 'Not authorized to request a PO quantity amendment';
  end if;
  if v_reason is null or jsonb_typeof(v_evidence)<>'array' or jsonb_array_length(v_evidence)=0 then
    raise exception 'PO amendment reason and evidence are required';
  end if;
  begin v_quantity:=(payload->>'amended_quantity')::numeric;
  exception when others then raise exception 'Amended quantity is invalid'; end;
  if v_quantity<=0 or v_quantity<>trunc(v_quantity) then
    raise exception 'Amended quantity must be a positive whole number for goods';
  end if;
  select * into v_po from procurement.purchase_orders
   where id=payload->>'purchase_order_id' for update;
  if not found or v_po.status not in ('approved','issued') then
    raise exception 'Only an approved or issued PO can be amended';
  end if;
  select * into v_line from procurement.purchase_order_lines
   where id=payload->>'po_line_id' and purchase_order_id=v_po.id
     and receiving_status='open' for update;
  if not found then raise exception 'Open PO line not found'; end if;
  if v_quantity<=v_line.quantity then raise exception 'PO quantity amendment must increase the ordered line quantity'; end if;
  select * into v_request from procurement.requests where id=v_po.request_id for share;
  if not found then raise exception 'The PO request policy context is unavailable'; end if;
  v_after_total:=coalesce(v_po.total,0)+(v_quantity-v_line.quantity)*coalesce(v_line.unit_price,0);
  select * into v_matrix from procurement.doa_matrices matrix
   where matrix.active and matrix.status='active'
     and matrix.department=v_request.department
     and matrix.effective_at<=v_effective_at
     and (matrix.expires_at is null or matrix.expires_at>v_effective_at)
   order by matrix.effective_at desc limit 1 for share;
  if not found then raise exception 'policy_decision_required: current effective department DOA matrix'; end if;
  v_required_tiers:=procurement.derive_approval_tiers(v_request.category,v_after_total,
    coalesce(v_request.sourcing_method,'rfq'));
  if exists (select 1 from procurement.purchase_order_amendments amendment
    where amendment.purchase_order_id=v_po.id
      and amendment.status in ('requested','under_review')) then
    raise exception 'Only one active quantity amendment is allowed per purchase order; finish or reject the current DOA review first';
  end if;
  insert into procurement.purchase_order_amendments(
    purchase_order_id,po_line_id,previous_quantity,amended_quantity,reason,evidence_urls,
    doa_matrix_id,doa_matrix_version,effective_at,department,category,
    before_commitment_version,after_commitment_version,before_commitment,after_commitment
  ) values(v_po.id,v_line.id,v_line.quantity,v_quantity,v_reason,v_evidence,
    v_matrix.id,v_matrix.version,v_effective_at,v_request.department,v_request.category,
    v_po.commitment_version,v_po.commitment_version+1,
    jsonb_build_object('version',v_po.commitment_version,'total',v_po.total,'line_id',v_line.id,'quantity',v_line.quantity),
    jsonb_build_object('version',v_po.commitment_version+1,'total',v_after_total,'line_id',v_line.id,'quantity',v_quantity))
  returning * into v_amendment;
  insert into procurement.purchase_order_amendment_steps(
    amendment_id,step_order,tier,assigned_user_id,doa_assignment_id
  )
  select v_amendment.id,
    row_number() over(order by array_position(v_required_tiers,assignment.tier)),
    assignment.tier,assignment.approver_user_id,assignment.id
  from procurement.doa_assignments assignment
  join core.profiles approver on approver.id=assignment.approver_user_id
  where assignment.matrix_id=v_matrix.id and assignment.active
    and assignment.department=v_request.department
    and (assignment.category is null or assignment.category=v_request.category)
    and v_after_total>=assignment.min_amount
    and (assignment.max_amount is null or v_after_total<=assignment.max_amount)
    and assignment.tier=any(v_required_tiers)
    and approver.kind='employee' and approver.status='active';
  select count(*),count(distinct tier) into v_step_count,v_distinct_step_count
  from procurement.purchase_order_amendment_steps where amendment_id=v_amendment.id;
  if v_step_count<>cardinality(v_required_tiers)
     or v_distinct_step_count<>cardinality(v_required_tiers) then
    raise exception 'policy_decision_required: exactly one named current-DOA approver per ordered amendment tier';
  end if;
  update procurement.purchase_order_amendments set status='under_review'
   where id=v_amendment.id returning * into v_amendment;
  return to_jsonb(v_amendment);
end;
$$;

create or replace function private.policy_approve_po_line_quantity_amendment(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_po procurement.purchase_orders;
  v_line procurement.purchase_order_lines;
  v_amendment procurement.purchase_order_amendments;
  v_step procurement.purchase_order_amendment_steps;
  v_profile core.profiles;
  v_signed_at timestamptz;
  v_signature_data text;
  v_signature_bytes bytea;
  v_decision text:=payload->>'decision';
  v_reason text:=nullif(pg_catalog.btrim(coalesce(payload->>'reason','')),'');
begin
  if v_decision not in ('approved','rejected') or v_reason is null then
    raise exception 'PO amendment decision and reason are required';
  end if;
  select * into v_amendment from procurement.purchase_order_amendments
   where id=(payload->>'amendment_id')::uuid and status='under_review' for update;
  if not found then raise exception 'Pending PO amendment not found'; end if;
  if v_amendment.requested_by=auth.uid() then
    raise exception 'The PO amendment requester cannot approve their own change';
  end if;
  select * into v_step from procurement.purchase_order_amendment_steps
   where amendment_id=v_amendment.id and status='pending'
   order by step_order limit 1 for update;
  if not found then raise exception 'No pending ordered amendment approval step'; end if;
  if v_step.assigned_user_id<>auth.uid() then
    raise exception 'Only the named current-DOA approver may decide the next amendment step';
  end if;
  if not exists (
    select 1
    from procurement.doa_assignments assignment
    join procurement.doa_matrices matrix on matrix.id=assignment.matrix_id
    join core.profiles approver on approver.id=assignment.approver_user_id
    where assignment.id=v_step.doa_assignment_id
      and assignment.matrix_id=v_amendment.doa_matrix_id
      and assignment.approver_user_id=auth.uid()
      and assignment.tier=v_step.tier and assignment.active
      and pg_catalog.lower(assignment.department)=pg_catalog.lower(v_amendment.department)
      and (assignment.category is null or assignment.category=''
        or pg_catalog.lower(assignment.category)=pg_catalog.lower(coalesce(v_amendment.category,'')))
      and coalesce((v_amendment.after_commitment->>'total')::numeric,0)>=assignment.min_amount
      and (assignment.max_amount is null
        or coalesce((v_amendment.after_commitment->>'total')::numeric,0)<=assignment.max_amount)
      and matrix.active and matrix.status='active'
      and pg_catalog.lower(matrix.department)=pg_catalog.lower(v_amendment.department)
      and matrix.effective_at<=current_timestamp
      and (matrix.expires_at is null or matrix.expires_at>current_timestamp)
      and matrix.id=(
        select current_matrix.id
        from procurement.doa_matrices current_matrix
        where current_matrix.active and current_matrix.status='active'
          and pg_catalog.lower(current_matrix.department)=pg_catalog.lower(v_amendment.department)
          and current_matrix.effective_at<=current_timestamp
          and (current_matrix.expires_at is null or current_matrix.expires_at>current_timestamp)
        order by current_matrix.effective_at desc,current_matrix.id desc limit 1
      )
      and approver.kind='employee' and approver.status='active'
  ) then
    raise exception 'Only a currently active DOA assignment and matrix may decide the next amendment step';
  end if;
  select * into v_profile from core.profiles
   where id=auth.uid() and kind='employee' and status='active';
  if not found or nullif(pg_catalog.btrim(coalesce(v_profile.full_name,'')),'') is null then
    raise exception 'PO amendment decisions require an active employee profile with a legal name';
  end if;
  if v_decision='approved' then
    v_signature_data:=coalesce(payload->'signature'->>'signature_png','');
    if jsonb_typeof(payload->'signature') is distinct from 'object'
       or v_signature_data !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'
       or pg_catalog.length(v_signature_data)>2796230
       or pg_catalog.btrim(coalesce(payload->'signature'->>'signer_name',''))
         is distinct from pg_catalog.btrim(v_profile.full_name)
       or coalesce(payload->'signature'->>'signature_method','') not in ('drawn','typed')
       or nullif(payload->'signature'->>'signed_at','') is null then
      raise exception 'PO amendment approval requires a PNG signature bound to the active employee profile';
    end if;
    begin
      v_signature_bytes:=decode(pg_catalog.substring(v_signature_data from 23),'base64');
    exception when others then
      raise exception 'PO amendment signature PNG payload is not valid base64';
    end;
    if pg_catalog.octet_length(v_signature_bytes)>2097152
       or pg_catalog.substring(v_signature_bytes from 1 for 8)
         is distinct from decode('89504e470d0a1a0a','hex') then
      raise exception 'PO amendment signature must be a valid PNG no larger than 2 MiB';
    end if;
    begin
      v_signed_at:=(payload->'signature'->>'signed_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'PO amendment signature signed_at is invalid';
    end;
    if v_signed_at<current_timestamp-interval '10 minutes'
       or v_signed_at>current_timestamp+interval '5 minutes' then
      raise exception 'PO amendment signature signed_at is outside the permitted signing window';
    end if;
  end if;
  select * into v_po from procurement.purchase_orders
   where id=v_amendment.purchase_order_id for update;
  select * into v_line from procurement.purchase_order_lines
   where id=v_amendment.po_line_id and purchase_order_id=v_po.id
     and receiving_status='open' for update;
  if not found or v_line.quantity is distinct from v_amendment.previous_quantity then
    raise exception 'PO line quantity changed after the amendment was requested';
  end if;
  update procurement.purchase_order_amendment_steps set status=v_decision,
    decision_reason=v_reason,signature=payload->'signature',decided_by=auth.uid(),decided_at=now()
   where id=v_step.id;
  if v_decision='rejected' then
    update procurement.purchase_order_amendment_steps set status='skipped',
      decision_reason='Cancelled after rejection'
     where amendment_id=v_amendment.id and status='pending';
    update procurement.purchase_order_amendments set status='rejected',
      decision='rejected',decided_by=auth.uid(),decided_at=now(),decision_reason=v_reason
     where id=v_amendment.id returning * into v_amendment;
    return to_jsonb(v_amendment);
  end if;
  if not exists (select 1 from procurement.purchase_order_amendment_steps
    where amendment_id=v_amendment.id and status='pending') then
    update procurement.purchase_order_lines set quantity=v_amendment.amended_quantity
     where id=v_line.id and quantity=v_amendment.previous_quantity;
    if not found then raise exception 'Concurrent PO line amendment conflict'; end if;
    update procurement.purchase_orders set
      total=(v_amendment.after_commitment->>'total')::numeric,
      commitment_version=v_amendment.after_commitment_version,updated_at=now()
     where id=v_po.id and commitment_version=v_amendment.before_commitment_version;
    if not found then raise exception 'Concurrent PO commitment version conflict'; end if;
    update procurement.purchase_order_amendments set status='approved',
      decision='approved',decided_by=auth.uid(),decided_at=now(),
      approved_by=auth.uid(),approved_at=now(),decision_reason=v_reason
     where id=v_amendment.id returning * into v_amendment;
  else
    update procurement.purchase_order_amendments set decision_reason=v_reason
     where id=v_amendment.id returning * into v_amendment;
  end if;
  return to_jsonb(v_amendment);
end;
$$;

create or replace function procurement.purchase_order_amendment_work_items(payload jsonb default '{}'::jsonb)
returns table(amendment_id uuid,purchase_order_id text,po_line_id text,po_number text,
  line_description text,previous_quantity numeric,amended_quantity numeric,status text,
  requested_by uuid,requested_at timestamptz,next_step_order integer,next_tier text,
  assigned_user_id uuid,can_decide boolean,reason text,evidence_urls jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not core.has_cap('procurement','author_po')
     and not core.has_module_role('procurement')
     and not exists (
       select 1
       from procurement.purchase_order_amendment_steps assigned_step
       where assigned_step.assigned_user_id=auth.uid()
         and assigned_step.status='pending'
     ) then
    raise exception 'Not authorized to view PO amendment work items';
  end if;
  return query
  select amendment.id,amendment.purchase_order_id,amendment.po_line_id,po.po_number,
    line.description,amendment.previous_quantity,amendment.amended_quantity,amendment.status,
    amendment.requested_by,amendment.requested_at,step.step_order,step.tier,
    step.assigned_user_id,step.assigned_user_id=auth.uid(),amendment.reason,amendment.evidence_urls
  from procurement.purchase_order_amendments amendment
  join procurement.purchase_orders po on po.id=amendment.purchase_order_id
  join procurement.purchase_order_lines line on line.id=amendment.po_line_id
  left join lateral (
    select pending.step_order,pending.tier,pending.assigned_user_id
    from procurement.purchase_order_amendment_steps pending
    where pending.amendment_id=amendment.id and pending.status='pending'
    order by pending.step_order limit 1
  ) step on true
  where (amendment.requested_by=auth.uid() or step.assigned_user_id=auth.uid())
    and (nullif(payload->>'status','') is null or amendment.status=payload->>'status')
  order by amendment.requested_at desc;
end;
$$;

create or replace function procurement.request_po_line_quantity_amendment(payload jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.policy_request_po_line_quantity_amendment(payload)
$$;
create or replace function procurement.approve_po_line_quantity_amendment(payload jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.policy_approve_po_line_quantity_amendment(payload)
$$;
revoke all on function private.policy_request_po_line_quantity_amendment(jsonb) from public,anon,authenticated;
revoke all on function private.policy_approve_po_line_quantity_amendment(jsonb) from public,anon,authenticated;
revoke all on function procurement.request_po_line_quantity_amendment(jsonb) from public,anon;
revoke all on function procurement.approve_po_line_quantity_amendment(jsonb) from public,anon;
revoke all on function procurement.purchase_order_amendment_work_items(jsonb) from public,anon;
grant execute on function private.policy_request_po_line_quantity_amendment(jsonb) to service_role;
grant execute on function private.policy_approve_po_line_quantity_amendment(jsonb) to service_role;
grant execute on function procurement.request_po_line_quantity_amendment(jsonb) to authenticated,service_role;
grant execute on function procurement.approve_po_line_quantity_amendment(jsonb) to authenticated,service_role;
grant execute on function procurement.purchase_order_amendment_work_items(jsonb) to authenticated,service_role;

create or replace function warehouse.procurement_receipt_excess_work_items(payload jsonb default '{}'::jsonb)
returns table(custody_id uuid,receipt_id text,purchase_order_id text,po_line_id text,
  po_number text,product_id text,product_name text,ordered_quantity integer,
  excess_quantity integer,status text,requested_at timestamptz,eligible_approved_amendments jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not core.has_cap('warehouse','resolve_exceptions')
     or not core.has_cap('warehouse','release_quality_hold') then
    raise exception 'Not authorized to view governed excess custody';
  end if;
  return query
  select custody.id,custody.receipt_id,decision.purchase_order_id,custody.po_line_id,
    po.po_number,custody.product_id,product.name,custody.ordered_quantity,
    custody.excess_quantity,custody.status,decision.requested_at,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',amendment.id,'previousQuantity',amendment.previous_quantity,
      'amendedQuantity',amendment.amended_quantity,'approvedAt',amendment.approved_at
    ) order by amendment.approved_at desc)
    from procurement.purchase_order_amendments amendment
    where amendment.purchase_order_id=decision.purchase_order_id
      and amendment.po_line_id=custody.po_line_id and amendment.status='approved'
      and amendment.previous_quantity=custody.ordered_quantity
      and amendment.amended_quantity-amendment.previous_quantity>=custody.excess_quantity
    ),'[]'::jsonb)
  from warehouse.procurement_receipt_excess_custody custody
  join warehouse.procurement_receipt_exception_decisions decision on decision.id=custody.decision_id
  join procurement.purchase_orders po on po.id=decision.purchase_order_id
  left join warehouse.products product on product.id=custody.product_id
  where custody.status in ('pending','held')
    and (nullif(payload->>'purchase_order_id','') is null
      or decision.purchase_order_id=payload->>'purchase_order_id')
  order by decision.requested_at,custody.id;
end;
$$;
revoke all on function warehouse.procurement_receipt_excess_work_items(jsonb) from public,anon;
grant execute on function warehouse.procurement_receipt_excess_work_items(jsonb) to authenticated,service_role;

create or replace function private.warehouse_inspect_quality_v2(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_receipt warehouse.receipts;
  v_product warehouse.products;
  v_unit warehouse.inventory_units;
  v_stock warehouse.stock_levels;
  v_inspection warehouse.quality_inspections;
  v_hold warehouse.inventory_holds;
  v_exception warehouse.exceptions;
  v_line_id text:=nullif(payload->>'procurement_po_line_id','');
  v_product_id text:=payload->>'product_id';
  v_bin_id text:=nullif(payload->>'bin_id','');
  v_lot_id text:=nullif(payload->>'lot_id','');
  v_serial text:=nullif(payload->>'serial_number','');
  v_quantity integer:=coalesce((payload->>'quantity')::integer,0);
  v_disposition text:=payload->>'disposition';
  v_reason text:=nullif(pg_catalog.btrim(coalesce(payload->>'reason','')),'');
  v_evidence jsonb:=coalesce(payload->'evidence_urls','[]'::jsonb);
  v_source_quantity integer;
  v_bin_count integer;
  v_source_total integer;
  v_inspected_total integer;
  v_previously_inspected integer;
  v_exact_held integer:=0;
  v_response jsonb;
begin
  if payload->>'source_type'<>'receipt' then
    return private.warehouse_inspect_quality(payload);
  end if;
  select * into v_receipt from warehouse.receipts
   where id=payload->>'source_id' for update;
  if not found then raise exception 'Receipt not found'; end if;
  if v_receipt.procurement_po_id is null then
    return private.warehouse_inspect_quality(payload);
  end if;
  if not core.has_cap('warehouse','inspect_quality') then
    raise exception 'Not authorized: warehouse.inspect_quality';
  end if;
  if v_line_id is null then
    raise exception 'Procurement PO-line identity is required for receipt quality disposition';
  end if;
  if exists (
    select 1
    from warehouse.procurement_receipt_exception_lines claim
    join warehouse.procurement_receipt_exception_decisions decision on decision.id=claim.decision_id
    where claim.active
      and (decision.receipt_id=v_receipt.id or claim.po_line_id=v_line_id)
  ) then
    raise exception 'Active controlled receipt exception must be finalized by the controlled exception resolver';
  end if;
  if v_disposition not in ('accepted','damaged','hold','vendor_return','unavailable') then
    raise exception 'Invalid quality disposition';
  end if;
  if v_quantity<=0 then raise exception 'Inspection quantity must be positive'; end if;
  if v_disposition<>'accepted' and v_reason is null then
    raise exception 'A reason is required for non-accepted stock';
  end if;
  if jsonb_typeof(v_evidence)<>'array' then raise exception 'Evidence must be an array'; end if;
  select * into v_product from warehouse.products where id=v_product_id for share;
  if not found then raise exception 'Quality product not found'; end if;
  perform private.lock_warehouse_products(array[v_product_id]);
  if v_disposition<>'accepted' and v_quantity>warehouse.available_to_promise(v_product_id) then
    raise exception 'Quality hold exceeds availability after active reservations and holds';
  end if;

  select coalesce(sum(coalesce((receipt_line->>'quantity')::integer,
      (receipt_line->>'actual_quantity')::integer,0)),0),
    count(distinct coalesce(nullif(receipt_line->>'binId',''),
      nullif(receipt_line->>'bin_id',''),'__general__')),
    max(coalesce(nullif(receipt_line->>'binId',''),nullif(receipt_line->>'bin_id','')))
    into v_source_quantity,v_bin_count,v_bin_id
  from jsonb_array_elements(v_receipt.lines) receipt_line
  where receipt_line->>'procurementLineId'=v_line_id
    and receipt_line->>'productId'=v_product_id
    and (v_serial is null or exists (
      select 1 from jsonb_array_elements_text(coalesce(receipt_line->'serialNumbers',
        receipt_line->'serial_numbers','[]'::jsonb)) serial where serial=v_serial
    ))
    and (v_lot_id is null or coalesce(nullif(receipt_line->>'lotId',''),
      nullif(receipt_line->>'lot_id',''))=v_lot_id)
    and (nullif(payload->>'bin_id','') is null or
      coalesce(nullif(receipt_line->>'binId',''),nullif(receipt_line->>'bin_id',''))
        is not distinct from nullif(payload->>'bin_id',''));
  if coalesce(v_source_quantity,0)=0 then
    raise exception 'Product or serial is not part of the exact receipt PO line';
  end if;
  if nullif(payload->>'bin_id','') is null and v_bin_count>1 then
    raise exception 'A bin is required when the product spans multiple exact receipt PO-line bins';
  end if;
  if v_product.serialized then
    if v_serial is null or v_quantity<>1 then
      raise exception 'Serialized receipt QC requires one exact serial identity';
    end if;
    select * into v_unit from warehouse.inventory_units
     where product_id=v_product_id and serial_number=v_serial
       and location_id=v_receipt.location_id
       and bin_id is not distinct from v_bin_id
       and status in ('in_stock','returned')
     for update;
    if not found then raise exception 'Exact serialized receipt unit is not available for QC'; end if;
    if exists (
      select 1 from warehouse.inventory_holds active_hold
      where active_hold.status='active'
        and active_hold.product_id=v_unit.product_id
        and active_hold.location_id=v_unit.location_id
        and active_hold.bin_id is not distinct from v_unit.bin_id
        and active_hold.lot_id is not distinct from v_unit.lot_id
        and active_hold.serial_number=v_unit.serial_number
    ) then raise exception 'Exact serialized receipt unit is already held'; end if;
    v_source_quantity:=1;
  elsif v_serial is not null then
    raise exception 'Serial identity is invalid for a non-serialized product';
  else
    select * into v_stock from warehouse.stock_levels
     where product_id=v_product_id and location_id=v_receipt.location_id
       and bin_id is not distinct from v_bin_id
       and lot_id is not distinct from v_lot_id
     for update;
    if not found then
      raise exception 'Exact receipt lot stock is not available for QC';
    end if;
    select coalesce(sum(active_hold.quantity),0)::integer into v_exact_held
    from warehouse.inventory_holds active_hold
    where active_hold.status='active'
      and active_hold.product_id=v_stock.product_id
      and active_hold.location_id=v_stock.location_id
      and active_hold.bin_id is not distinct from v_stock.bin_id
      and active_hold.lot_id is not distinct from v_stock.lot_id
      and active_hold.serial_number is null;
    if v_stock.quantity-v_exact_held<v_quantity then
      raise exception 'Exact receipt lot stock is not available after active holds';
    end if;
  end if;

  v_started:=private.begin_idempotent_command('inspect_quality',payload->>'idempotency_key',payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id:=(v_started->>'command_id')::uuid;

  delete from warehouse.quality_inspections quality
   where quality.source_type='receipt' and quality.source_id=v_receipt.id
     and quality.product_id=v_product_id
     and quality.procurement_po_line_id=v_line_id
     and quality.bin_id is not distinct from v_bin_id
     and quality.lot_id is not distinct from v_lot_id
     and quality.serial_number is not distinct from v_serial
     and quality.disposition='pending';
  select coalesce(sum(quality.quantity),0) into v_previously_inspected
  from warehouse.quality_inspections quality
  where quality.source_type='receipt' and quality.source_id=v_receipt.id
    and quality.product_id=v_product_id
    and quality.procurement_po_line_id=v_line_id
    and quality.bin_id is not distinct from v_bin_id
    and quality.lot_id is not distinct from v_lot_id
    and quality.serial_number is not distinct from v_serial
    and quality.disposition<>'pending';
  if v_previously_inspected+v_quantity>v_source_quantity then
    raise exception 'Inspection quantity exceeds the remaining exact PO-line source quantity';
  end if;

  insert into warehouse.quality_inspections(
    source_type,source_id,product_id,lot_id,serial_number,location_id,bin_id,
    quantity,disposition,reason,evidence_urls,inspected_by,inspected_by_email,
    procurement_po_line_id
  ) values(
    'receipt',v_receipt.id,v_product_id,v_lot_id,v_serial,v_receipt.location_id,v_bin_id,
    v_quantity,v_disposition,v_reason,v_evidence,auth.uid(),
    coalesce(auth.jwt()->>'email',''),v_line_id
  ) returning * into v_inspection;
  if v_disposition<>'accepted' then
    insert into warehouse.inventory_holds(
      inspection_id,product_id,location_id,bin_id,lot_id,serial_number,quantity,status,
      reason,evidence_urls,created_by
    ) values(
      v_inspection.id,v_product_id,v_receipt.location_id,v_bin_id,v_lot_id,v_serial,
      v_quantity,'active',v_reason,v_evidence,auth.uid()
    ) returning * into v_hold;
    insert into warehouse.exceptions(
      exception_type,severity,source_type,source_id,status,due_at,created_by
    ) values('quality','P2','quality_inspection',v_inspection.id::text,'open',now()+interval '1 day',auth.uid())
    returning * into v_exception;
  end if;

  select coalesce(sum(coalesce((receipt_line->>'quantity')::integer,
    (receipt_line->>'actual_quantity')::integer,0)),0)
    into v_source_total from jsonb_array_elements(v_receipt.lines) receipt_line;
  select coalesce(sum(quality.quantity),0) into v_inspected_total
  from warehouse.quality_inspections quality
  where quality.source_type='receipt' and quality.source_id=v_receipt.id
    and quality.disposition<>'pending';
  update warehouse.receipts set quality_status=case
    when exists (
      select 1 from warehouse.inventory_holds active_hold
      join warehouse.quality_inspections quality on quality.id=active_hold.inspection_id
      where quality.source_type='receipt' and quality.source_id=v_receipt.id
        and active_hold.status='active'
    ) then 'hold'
    when v_inspected_total>=v_source_total then 'accepted'
    else 'partial' end
   where id=v_receipt.id;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('warehouse','quality_inspection',v_inspection.id,'inspected',auth.uid(),
    jsonb_build_object('source_id',v_receipt.id,'procurement_po_line_id',v_line_id,
      'quantity',v_quantity,'disposition',v_disposition,'hold_id',v_hold.id));
  v_response:=jsonb_build_object('inspection',to_jsonb(v_inspection),
    'hold',case when v_hold.id is null then null else to_jsonb(v_hold) end,
    'exception',case when v_exception.id is null then null else to_jsonb(v_exception) end);
  return private.finish_idempotent_command(v_command_id,v_response);
end;
$$;

create or replace function warehouse.inspect_quality(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_receipt warehouse.receipts;
  v_line_id text:=nullif(payload->>'procurement_po_line_id','');
begin
  if not core.has_cap('warehouse','inspect_quality') then
    raise exception 'Not authorized: warehouse.inspect_quality';
  end if;
  if payload->>'source_type'='receipt' then
    select * into v_receipt from warehouse.receipts where id=payload->>'source_id';
    if v_receipt.procurement_po_id is not null then
      if v_line_id is null then
        raise exception 'Procurement PO-line identity is required for receipt quality disposition';
      end if;
      if not exists (
        select 1 from jsonb_array_elements(v_receipt.lines) receipt_line
        where receipt_line->>'procurementLineId'=v_line_id
          and receipt_line->>'productId'=payload->>'product_id'
      ) then raise exception 'Quality disposition PO line does not belong to the receipt'; end if;
      if exists (
        select 1 from warehouse.procurement_receipt_exception_lines claim
        join warehouse.procurement_receipt_exception_decisions decision on decision.id=claim.decision_id
        where claim.active
          and (decision.receipt_id=v_receipt.id or claim.po_line_id=v_line_id)
      ) then
        raise exception 'Active controlled receipt exception must be finalized by the controlled exception resolver';
      end if;
    end if;
  end if;
  return private.warehouse_inspect_quality_v2(payload);
end;
$$;
revoke all on function private.warehouse_inspect_quality_v2(jsonb) from public,anon,authenticated;
revoke all on function private.warehouse_inspect_quality(jsonb) from public,anon,authenticated;
revoke all on function warehouse.inspect_quality(jsonb) from public,anon;
grant execute on function private.warehouse_inspect_quality_v2(jsonb) to service_role;
grant execute on function private.warehouse_inspect_quality(jsonb) to service_role;
grant execute on function warehouse.inspect_quality(jsonb) to authenticated,service_role;

create or replace function private.warehouse_reject_quality_hold_to_vendor(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_hold warehouse.inventory_holds;
  v_inspection warehouse.quality_inspections;
  v_receipt warehouse.receipts;
  v_po procurement.purchase_orders;
  v_line procurement.purchase_order_lines;
  v_vendor_return warehouse.vendor_returns;
  v_reason text:=nullif(pg_catalog.btrim(coalesce(payload->>'reason','')),'');
  v_reference text:=nullif(pg_catalog.btrim(coalesce(payload->>'reference','')),'');
  v_evidence jsonb:=coalesce(payload->'evidence_urls','[]'::jsonb);
  v_response jsonb;
begin
  v_started:=private.begin_idempotent_command(
    'reject_quality_hold_to_vendor',payload->>'idempotency_key',payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id:=(v_started->>'command_id')::uuid;
  if not core.has_cap('warehouse','release_quality_hold')
     or not core.has_cap('warehouse','manage_returns') then
    raise exception 'Not authorized: controlled hold rejection requires Supervisor returns authority';
  end if;
  if v_reason is null or v_reference is null
     or jsonb_typeof(v_evidence)<>'array' or jsonb_array_length(v_evidence)=0 then
    raise exception 'Hold rejection reason, reference, and evidence are required';
  end if;
  select * into v_hold from warehouse.inventory_holds
   where id=(payload->>'hold_id')::uuid and status='active' for update;
  if not found then raise exception 'Active hold not found'; end if;
  if v_hold.created_by=auth.uid() then
    raise exception 'The hold creator cannot reject their own hold to a vendor';
  end if;
  perform private.lock_warehouse_products(array[v_hold.product_id]);
  select * into v_inspection from warehouse.quality_inspections
   where id=v_hold.inspection_id for update;
  if not found or v_inspection.disposition not in ('hold','damaged','unavailable','vendor_return') then
    raise exception 'Held inspection is not eligible for vendor rejection';
  end if;
  if not exists (select 1 from warehouse.suppliers where id=payload->>'supplier_id') then
    raise exception 'Supplier not found';
  end if;
  if v_inspection.source_type='receipt' then
    select * into v_receipt from warehouse.receipts
     where id=v_inspection.source_id for update;
    if v_receipt.supplier_id is distinct from payload->>'supplier_id' then
      raise exception 'Vendor return supplier must match the source receipt';
    end if;
    if v_receipt.procurement_po_id is not null and v_inspection.procurement_po_line_id is not null then
      select * into v_po from procurement.purchase_orders
       where id=v_receipt.procurement_po_id for update;
      select * into v_line from procurement.purchase_order_lines
       where id=v_inspection.procurement_po_line_id and purchase_order_id=v_po.id for update;
      if not found then raise exception 'Held receipt PO-line binding is invalid'; end if;
    end if;
  end if;
  if v_hold.serial_number is not null then
    update warehouse.inventory_units set status='vendor_return',assigned_to=null
     where product_id=v_hold.product_id and serial_number=v_hold.serial_number
       and location_id=v_hold.location_id and status in ('in_stock','returned');
    if not found then raise exception 'Held serialized unit is not available for vendor return'; end if;
  else
    update warehouse.stock_levels set quantity=quantity-v_hold.quantity
     where product_id=v_hold.product_id and location_id=v_hold.location_id
       and bin_id is not distinct from v_hold.bin_id
       and lot_id is not distinct from v_hold.lot_id
       and quantity>=v_hold.quantity;
    if not found then raise exception 'Held quantity is not available for vendor return'; end if;
  end if;
  insert into warehouse.vendor_returns(
    hold_id,supplier_id,source_receipt_id,source_return_id,product_id,lot_id,
    serial_number,quantity,reason,reference,status,evidence_urls,created_by
  ) values(
    v_hold.id,payload->>'supplier_id',
    case when v_inspection.source_type='receipt' then v_inspection.source_id end,
    case when v_inspection.source_type='return' then v_inspection.source_id end,
    v_hold.product_id,v_hold.lot_id,v_hold.serial_number,v_hold.quantity,
    v_reason,v_reference,'ready',v_evidence,auth.uid()
  ) returning * into v_vendor_return;
  update warehouse.inventory_holds set status='vendor_return',released_by=auth.uid(),
    released_at=now(),release_reason=v_reason,release_evidence_urls=v_evidence
   where id=v_hold.id returning * into v_hold;
  update warehouse.quality_inspections set disposition='vendor_return',reason=v_reason,
    evidence_urls=v_evidence where id=v_inspection.id returning * into v_inspection;
  insert into warehouse.movements(
    id,type,product_id,quantity,from_location_id,from_bin_id,lot_id,serial_number,
    reason,reference,evidence_urls,actor,created_at
  ) values(
    'mv-'||replace(gen_random_uuid()::text,'-',''),'vendor_return',v_hold.product_id,
    v_hold.quantity,v_hold.location_id,v_hold.bin_id,v_hold.lot_id,v_hold.serial_number,
    v_reason,v_vendor_return.id::text,v_evidence,
    coalesce(auth.jwt()->>'email',auth.uid()::text),now()
  );
  update warehouse.exceptions set status='resolved',
    resolution='Vendor return '||v_reference||' created',evidence_urls=v_evidence,updated_at=now()
   where source_type='quality_inspection' and source_id=v_inspection.id::text
     and status in ('open','in_progress');
  if v_inspection.source_type='receipt' and v_inspection.procurement_po_line_id is not null then
    update warehouse.procurement_receipt_excess_custody custody
       set status='vendor_return',resolution_reason=v_reason,resolution_evidence_urls=v_evidence,
           resolved_by=auth.uid(),resolved_at=now()
      from warehouse.procurement_receipt_exception_decisions decision
     where custody.decision_id=decision.id and decision.receipt_id=v_inspection.source_id
       and custody.po_line_id=v_inspection.procurement_po_line_id
       and custody.status in ('pending','held');
    if exists (select 1 from warehouse.procurement_receipt_exception_lines claim
      where claim.po_line_id=v_inspection.procurement_po_line_id and claim.active) then
      perform private.release_procurement_receipt_line_claim(
        v_inspection.source_id,v_inspection.procurement_po_line_id
      );
    end if;
  end if;
  if v_inspection.source_type='receipt' then
    update warehouse.receipts set quality_status=case when exists (
      select 1 from warehouse.inventory_holds active_hold
      join warehouse.quality_inspections quality on quality.id=active_hold.inspection_id
      where quality.source_type='receipt' and quality.source_id=v_inspection.source_id
        and active_hold.status='active'
    ) then 'hold' else 'closed' end where id=v_inspection.source_id returning * into v_receipt;
  end if;
  if v_po.id is not null then
    update procurement.purchase_orders set status=case when not exists (
      select 1 from procurement.purchase_order_lines open_line
      where open_line.purchase_order_id=v_po.id and open_line.receiving_status='open'
        and open_line.received_quantity<open_line.quantity
    ) and not exists (
      select 1 from warehouse.procurement_receipt_exception_lines active_line
      join warehouse.procurement_receipt_exception_decisions decision on decision.id=active_line.decision_id
      where active_line.active and decision.purchase_order_id=v_po.id
    ) then 'closed' else 'issued' end,updated_at=now()
     where id=v_po.id returning * into v_po;
  end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('warehouse','inventory_hold',v_hold.id,'rejected_to_vendor',auth.uid(),
    jsonb_build_object('inspection_id',v_inspection.id,'vendor_return_id',v_vendor_return.id,
      'purchase_order_id',v_po.id,'po_line_id',v_inspection.procurement_po_line_id,
      'reason',v_reason));
  v_response:=jsonb_build_object('hold',to_jsonb(v_hold),'inspection',to_jsonb(v_inspection),
    'vendor_return',to_jsonb(v_vendor_return),'receipt',to_jsonb(v_receipt),'purchase_order',to_jsonb(v_po));
  return private.finish_idempotent_command(v_command_id,v_response);
end;
$$;

create or replace function warehouse.reject_quality_hold_to_vendor(payload jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.warehouse_reject_quality_hold_to_vendor(payload)
$$;
revoke all on function private.warehouse_reject_quality_hold_to_vendor(jsonb) from public,anon,authenticated;
revoke all on function warehouse.reject_quality_hold_to_vendor(jsonb) from public,anon;
grant execute on function private.warehouse_reject_quality_hold_to_vendor(jsonb) to service_role;
grant execute on function warehouse.reject_quality_hold_to_vendor(jsonb) to authenticated,service_role;

create table if not exists procurement.payment_readiness_staleness_events (
  id uuid primary key default gen_random_uuid(),
  payment_readiness_pack_id uuid not null references procurement.payment_readiness_packs(id) on delete restrict,
  purchase_order_id text not null references procurement.purchase_orders(id) on delete restrict,
  prior_status text not null,
  prior_acceptance_evidence_version bigint not null,
  acceptance_evidence_version bigint not null,
  reason text not null,
  recorded_at timestamptz not null default now(),
  unique(payment_readiness_pack_id,acceptance_evidence_version)
);
alter table procurement.payment_readiness_staleness_events enable row level security;
alter table procurement.payment_readiness_staleness_events force row level security;
revoke all on procurement.payment_readiness_staleness_events from public,anon,authenticated;
grant all on procurement.payment_readiness_staleness_events to service_role;
alter table procurement.payment_readiness_packs
  add column if not exists evidence_stale boolean not null default false,
  add column if not exists evidence_stale_at timestamptz;

create or replace function procurement.payment_readiness_staleness_work_items(payload jsonb default '{}'::jsonb)
returns table(event_id uuid,payment_readiness_pack_id uuid,purchase_order_id text,
  prior_status text,prior_acceptance_evidence_version bigint,acceptance_evidence_version bigint,
  reason text,recorded_at timestamptz,finance_reviewed_by_email text,
  finance_reviewed_at timestamptz,finance_note text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not core.has_cap('procurement','view_finance') and not core.has_cap('procurement','admin') then
    raise exception 'Not authorized to view Finance evidence staleness';
  end if;
  return query select event.id,event.payment_readiness_pack_id,event.purchase_order_id,
    event.prior_status,event.prior_acceptance_evidence_version,event.acceptance_evidence_version,
    event.reason,event.recorded_at,reviewer.email,pack.finance_reviewed_at,pack.finance_note
  from procurement.payment_readiness_staleness_events event
  join procurement.payment_readiness_packs pack on pack.id=event.payment_readiness_pack_id
  left join core.profiles reviewer on reviewer.id=pack.finance_reviewed_by
  where nullif(payload->>'purchase_order_id','') is null
     or event.purchase_order_id=payload->>'purchase_order_id'
  order by event.recorded_at desc;
end;
$$;
revoke all on function procurement.payment_readiness_staleness_work_items(jsonb) from public,anon;
grant execute on function procurement.payment_readiness_staleness_work_items(jsonb) to authenticated,service_role;

create or replace function private.invalidate_payment_readiness_for_acceptance_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_po_id text;
  v_prior_version bigint;
  v_next_version bigint;
begin
  v_po_id:=case when tg_op='DELETE' then old.purchase_order_id else new.purchase_order_id end;
  if not (
    (tg_op='INSERT' and new.status in ('accepted','accepted_with_exceptions'))
    or (tg_op='DELETE' and old.status in ('accepted','accepted_with_exceptions'))
    or (tg_op='UPDATE' and (
      old.status in ('accepted','accepted_with_exceptions')
      or new.status in ('accepted','accepted_with_exceptions')
    ) and to_jsonb(old) is distinct from to_jsonb(new))
  ) then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  select acceptance_evidence_version into v_prior_version
  from procurement.purchase_orders where id=v_po_id for update;
  v_next_version:=v_prior_version+1;
  update procurement.purchase_orders
     set acceptance_evidence_version=v_next_version,updated_at=now()
   where id=v_po_id;
  update procurement.payment_readiness_packs
     set status='superseded'
   where purchase_order_id=v_po_id and status in ('draft','returned','ready_for_finance');
  insert into procurement.payment_readiness_staleness_events(
    payment_readiness_pack_id,purchase_order_id,prior_status,
    prior_acceptance_evidence_version,acceptance_evidence_version,reason
  )
  select pack.id,pack.purchase_order_id,pack.status,pack.acceptance_evidence_version,
    v_next_version,'Acceptance evidence changed after the Finance decision was finalized'
  from procurement.payment_readiness_packs pack
  where pack.purchase_order_id=v_po_id and pack.status in ('accepted','released')
  on conflict(payment_readiness_pack_id,acceptance_evidence_version) do nothing;
  update procurement.payment_readiness_packs
     set evidence_stale=true,evidence_stale_at=now()
   where purchase_order_id=v_po_id and status in ('accepted','released');
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists invalidate_payment_readiness_for_acceptance_change
  on procurement.acceptance_packs;
create trigger invalidate_payment_readiness_for_acceptance_change
after insert or delete or update of status,accepted_scope,exceptions
on procurement.acceptance_packs for each row
execute function private.invalidate_payment_readiness_for_acceptance_change();
revoke all on function private.invalidate_payment_readiness_for_acceptance_change()
  from public,anon,authenticated;
grant execute on function private.invalidate_payment_readiness_for_acceptance_change()
  to service_role;

-- Final issue authority: exact held serial and lot identities are never issuable.
create or replace function warehouse.issue(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_alloc warehouse.allocations;
  v_stock warehouse.stock_levels;
  v_unit_ids text[];
  v_expected integer;
  v_updated integer;
  v_serialized boolean;
  v_d jsonb;
  v_delta integer;
  v_sum integer:=0;
  v_exact_held integer:=0;
  v_actor text;
  v_movement jsonb;
  v_source_location text;
  v_source_bin text;
  v_source_lot text;
  v_source_serial text;
  v_source_row_count integer:=0;
begin
  if not core.has_cap('warehouse','issue_items') then
    raise exception 'Not authorized: issue_items';
  end if;
  select * into v_alloc from warehouse.allocations
   where id=payload->>'allocation_id' and status='reserved' for update;
  if not found then
    raise exception 'Allocation not found or not reservable: %',payload->>'allocation_id';
  end if;
  perform private.lock_warehouse_products(array[v_alloc.product_id]);
  select serialized into v_serialized from warehouse.products
   where id=v_alloc.product_id for share;
  if not found then raise exception 'Allocation product not found'; end if;

  v_actor:=warehouse.authoritative_actor();
  v_movement:=warehouse.force_actor_on_object(coalesce(payload->'movement','{}'::jsonb),v_actor);
  if coalesce(v_movement->>'type','')<>'issue'
     or v_movement->>'product_id' is distinct from v_alloc.product_id
     or coalesce((v_movement->>'quantity')::integer,0)<>v_alloc.quantity then
    raise exception 'Issue movement must match the reserved allocation product and quantity';
  end if;

  if v_serialized then
    if jsonb_typeof(payload->'unit_ids') is distinct from 'array' then
      raise exception 'Serialized issue requires exact unit identities';
    end if;
    v_unit_ids:=array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected:=coalesce(array_length(v_unit_ids,1),0);
    if v_expected<>v_alloc.quantity
       or (select count(distinct unit_id) from unnest(v_unit_ids) unit_id)<>v_expected then
      raise exception 'Must issue exactly % distinct serialized unit(s), got %',
        v_alloc.quantity,v_expected;
    end if;
    update warehouse.inventory_units unit set
      status='issued',assigned_to=payload->>'assigned_to',event_id=v_alloc.event_id
     where unit.id=any(v_unit_ids) and unit.status='in_stock'
       and unit.product_id=v_alloc.product_id
       and not exists (
         select 1 from warehouse.inventory_holds active_hold
          where active_hold.status='active'
            and active_hold.product_id=unit.product_id
            and active_hold.location_id=unit.location_id
            and active_hold.bin_id is not distinct from unit.bin_id
            and active_hold.lot_id is not distinct from unit.lot_id
            and active_hold.serial_number=unit.serial_number
       );
    get diagnostics v_updated=row_count;
    if v_updated<>v_expected then
      raise exception 'Held serialized units cannot be issued; all units must be exact, in stock, and unheld (% of %)',
        v_updated,v_expected;
    end if;
    select min(unit.location_id),
      case when count(distinct coalesce(unit.bin_id,'__NULL__'))=1 then min(unit.bin_id) end,
      case when count(distinct coalesce(unit.lot_id,'__NULL__'))=1 then min(unit.lot_id) end,
      case when v_expected=1 then min(unit.serial_number) end
    into v_source_location,v_source_bin,v_source_lot,v_source_serial
    from warehouse.inventory_units unit where unit.id=any(v_unit_ids);
  else
    if jsonb_typeof(payload->'stock_deltas') is distinct from 'array'
       or jsonb_array_length(payload->'stock_deltas')=0 then
      raise exception 'Missing exact stock movement for non-serialized issue';
    end if;
    for v_d in select * from jsonb_array_elements(payload->'stock_deltas') loop
      if v_d->>'product_id' is distinct from v_alloc.product_id then
        raise exception 'Issue stock delta product does not match the allocation';
      end if;
      begin v_delta:=(v_d->>'delta')::integer;
      exception when others then raise exception 'Issue stock delta is invalid'; end;
      if v_delta>=0 then raise exception 'Issue stock deltas must be negative'; end if;
      select * into v_stock from warehouse.stock_levels stock
       where stock.product_id=v_alloc.product_id
         and stock.location_id=v_d->>'location_id'
         and stock.bin_id is not distinct from nullif(v_d->>'bin_id','')
         and stock.lot_id is not distinct from nullif(v_d->>'lot_id','')
       for update;
      if not found then raise exception 'Issue stock row not found for the exact bin and lot'; end if;
      v_source_row_count:=v_source_row_count+1;
      if v_source_row_count=1 then
        v_source_location:=v_stock.location_id;
        v_source_bin:=v_stock.bin_id;
        v_source_lot:=v_stock.lot_id;
      elsif v_source_location is distinct from v_stock.location_id then
        raise exception 'A single issue movement cannot span source locations';
      else
        if v_source_bin is distinct from v_stock.bin_id then v_source_bin:=null; end if;
        if v_source_lot is distinct from v_stock.lot_id then v_source_lot:=null; end if;
      end if;
      select coalesce(sum(active_hold.quantity),0)::integer into v_exact_held
      from warehouse.inventory_holds active_hold
      where active_hold.status='active'
        and active_hold.product_id=v_stock.product_id
        and active_hold.location_id=v_stock.location_id
        and active_hold.bin_id is not distinct from v_stock.bin_id
        and active_hold.lot_id is not distinct from v_stock.lot_id
        and active_hold.serial_number is null;
      if v_stock.quantity-v_exact_held<abs(v_delta) then
        raise exception 'Held exact lot stock cannot be issued; requested %, unheld %',
          abs(v_delta),greatest(0,v_stock.quantity-v_exact_held);
      end if;
      update warehouse.stock_levels set quantity=quantity+v_delta
       where product_id=v_stock.product_id and location_id=v_stock.location_id
         and bin_id is not distinct from v_stock.bin_id
         and lot_id is not distinct from v_stock.lot_id;
      v_sum:=v_sum+abs(v_delta);
    end loop;
    if v_sum<>v_alloc.quantity then
      raise exception 'Issue deltas must sum to the allocation quantity (% vs %)',
        v_sum,v_alloc.quantity;
    end if;
  end if;

  update warehouse.allocations set status='issued'
   where id=v_alloc.id and status='reserved' returning * into v_alloc;
  if not found then raise exception 'Allocation changed during issue'; end if;
  v_movement:=v_movement || jsonb_build_object(
    'id','mv-'||replace(gen_random_uuid()::text,'-',''),
    'event_id',v_alloc.event_id,
    'reference',v_alloc.id,
    'from_location_id',v_source_location,
    'from_bin_id',v_source_bin,
    'lot_id',v_source_lot,
    'serial_number',v_source_serial,
    'to_location_id',null,
    'to_bin_id',null,
    'created_at',now()
  );
  insert into warehouse.movements
  select * from jsonb_populate_record(null::warehouse.movements,v_movement);
  return to_jsonb(v_alloc);
end;
$$;
revoke all on function warehouse.issue(jsonb) from public,anon;
grant execute on function warehouse.issue(jsonb) to authenticated,service_role;
