-- Forward convergence for databases that already recorded the organization and
-- Task 3 receipt-authority migrations. Historical migrations remain immutable.

alter table core.departments
  drop constraint if exists departments_code_check;

alter table core.departments
  add constraint departments_code_check
  check (
    code = pg_catalog.lower(code)
    and code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
  );

-- Recreate the governed amendment decision function with callable,
-- schema-qualified substring syntax supported by PostgreSQL.
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
      v_signature_bytes:=decode(pg_catalog.substring(v_signature_data, 23),'base64');
    exception when others then
      raise exception 'PO amendment signature PNG payload is not valid base64';
    end;
    if pg_catalog.octet_length(v_signature_bytes)>2097152
       or pg_catalog.substring(v_signature_bytes, 1, 8)
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
