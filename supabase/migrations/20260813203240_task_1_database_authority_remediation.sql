-- Task 1 full-audit authority remediation. Forward-only: this migration wraps
-- every audited mutation boundary with certification-aware authority and leaves
-- historical migrations intact.

insert into core.capabilities(module, cap) values
  ('procurement', 'manage_replenishment'),
  ('procurement', 'release_payment'),
  ('procurement', 'review_payment_readiness'),
  ('warehouse', 'register_exports'),
  ('warehouse', 'review_exports')
on conflict (module, cap) do nothing;

insert into core.role_capabilities(module, role, cap) values
  ('warehouse', 'operations', 'register_exports'),
  ('warehouse', 'finance', 'register_exports'),
  ('warehouse', 'finance', 'review_exports'),
  ('procurement', 'procurement_officer', 'manage_replenishment'),
  ('procurement', 'admin', 'manage_replenishment'),
  ('procurement', 'finance', 'release_payment'),
  ('procurement', 'admin', 'release_payment'),
  ('procurement', 'finance', 'review_payment_readiness'),
  ('procurement', 'admin', 'review_payment_readiness')
on conflict (module, role, cap) do nothing;

-- Preserve current implementations behind unexposed names, then make the RPC
-- boundary certification-aware. The implementation owner remains postgres.
alter function warehouse.issue(jsonb) rename to issue_uncertified_impl;
alter function warehouse.record_return(jsonb) rename to record_return_uncertified_impl;
alter function warehouse.record_cycle_count(jsonb) rename to record_cycle_count_uncertified_impl;
alter function warehouse.receive_against_po(jsonb) rename to receive_against_po_uncertified_impl;
alter function warehouse.adjust_stock(jsonb) rename to adjust_stock_uncertified_impl;
alter function procurement.decide_request_step(jsonb) rename to decide_request_step_uncertified_impl;
alter function core.manage_finance_close_entry(jsonb) rename to manage_finance_close_entry_uncertified_impl;
alter function product.submit_readiness_package(jsonb) rename to submit_readiness_package_uncertified_impl;
alter function product.decide_readiness_package(jsonb) rename to decide_readiness_package_uncertified_impl;
alter function product.acknowledge_operations_handoff(jsonb) rename to acknowledge_operations_handoff_uncertified_impl;
alter function product.submit_price_proposal(jsonb) rename to submit_price_proposal_uncertified_impl;
alter function product.decide_price_proposal(jsonb) rename to decide_price_proposal_uncertified_impl;
alter function procurement.manage_replenishment_recommendation(jsonb) rename to manage_replenishment_recommendation_uncertified_impl;
alter function procurement.release_payment(jsonb) rename to release_payment_uncertified_impl;
alter function procurement.review_payment_readiness(jsonb) rename to review_payment_readiness_uncertified_impl;
alter function warehouse.register_export_job(jsonb) rename to register_export_job_uncertified_impl;
alter function warehouse.review_export_job(jsonb) rename to review_export_job_uncertified_impl;
alter function legal.approve_accreditation_case(jsonb) rename to approve_accreditation_case_uncertified_impl;

create or replace function warehouse.issue(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'issue_items') then raise exception 'Not authorized: warehouse.issue_items'; end if; return warehouse.issue_uncertified_impl(payload); end; $$;
create or replace function warehouse.record_return(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'manage_returns') then raise exception 'Not authorized: warehouse.manage_returns'; end if; return warehouse.record_return_uncertified_impl(payload); end; $$;
create or replace function warehouse.record_cycle_count(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'cycle_count') then raise exception 'Not authorized: warehouse.cycle_count'; end if; return warehouse.record_cycle_count_uncertified_impl(payload); end; $$;
create or replace function warehouse.receive_against_po(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'receive_stock') then raise exception 'Not authorized: warehouse.receive_stock'; end if; return warehouse.receive_against_po_uncertified_impl(payload); end; $$;
create or replace function warehouse.adjust_stock(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'cycle_count') then raise exception 'Not authorized: warehouse.cycle_count'; end if; return warehouse.adjust_stock_uncertified_impl(payload); end; $$;
create or replace function procurement.decide_request_step(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('procurement', 'approve_request') then raise exception 'Not authorized: procurement.approve_request'; end if; return procurement.decide_request_step_uncertified_impl(payload); end; $$;
create or replace function core.manage_finance_close_entry(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'manage_finance_close') then raise exception 'Not authorized: warehouse.manage_finance_close'; end if; return core.manage_finance_close_entry_uncertified_impl(payload); end; $$;
create or replace function product.submit_readiness_package(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('product', 'prepare_readiness') then raise exception 'Not authorized: product.prepare_readiness'; end if; return product.submit_readiness_package_uncertified_impl(payload); end; $$;
create or replace function product.decide_readiness_package(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('product', 'decide_go_live') then raise exception 'Not authorized: product.decide_go_live'; end if; return product.decide_readiness_package_uncertified_impl(payload); end; $$;
create or replace function product.acknowledge_operations_handoff(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('product', 'acknowledge_operations_handoff') then raise exception 'Not authorized: product.acknowledge_operations_handoff'; end if; return product.acknowledge_operations_handoff_uncertified_impl(payload); end; $$;
create or replace function product.submit_price_proposal(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('product', 'propose_pricing') then raise exception 'Not authorized: product.propose_pricing'; end if; return product.submit_price_proposal_uncertified_impl(payload); end; $$;
create or replace function product.decide_price_proposal(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('product', 'approve_pricing') then raise exception 'Not authorized: product.approve_pricing'; end if; return product.decide_price_proposal_uncertified_impl(payload); end; $$;
create or replace function procurement.manage_replenishment_recommendation(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('procurement', 'manage_replenishment') then raise exception 'Not authorized: procurement.manage_replenishment'; end if; return procurement.manage_replenishment_recommendation_uncertified_impl(payload); end; $$;
create or replace function procurement.release_payment(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('procurement', 'release_payment') then raise exception 'Not authorized: procurement.release_payment'; end if; return procurement.release_payment_uncertified_impl(payload); end; $$;
create or replace function procurement.review_payment_readiness(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('procurement', 'review_payment_readiness') then raise exception 'Not authorized: procurement.review_payment_readiness'; end if; return procurement.review_payment_readiness_uncertified_impl(payload); end; $$;
create or replace function warehouse.register_export_job(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'register_exports') then raise exception 'Not authorized: warehouse.register_exports'; end if; return warehouse.register_export_job_uncertified_impl(payload); end; $$;
create or replace function warehouse.review_export_job(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'review_exports') then raise exception 'Not authorized: warehouse.review_exports'; end if; return warehouse.review_export_job_uncertified_impl(payload); end; $$;
create or replace function legal.approve_accreditation_case(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('legal', 'approve_accreditation') then raise exception 'Not authorized: legal.approve_accreditation'; end if; return legal.approve_accreditation_case_uncertified_impl(payload); end; $$;

create or replace function warehouse.transfer(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'transfer_stock') then raise exception 'Not authorized: warehouse.transfer_stock'; end if; return private.warehouse_transfer(payload); end; $$;
create or replace function warehouse.inspect_quality(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'inspect_quality') then raise exception 'Not authorized: warehouse.inspect_quality'; end if; return private.warehouse_inspect_quality(payload); end; $$;
create or replace function warehouse.release_quality_hold(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'release_quality_hold') then raise exception 'Not authorized: warehouse.release_quality_hold'; end if; return private.warehouse_release_quality_hold(payload); end; $$;
create or replace function warehouse.create_vendor_return(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'manage_returns') then raise exception 'Not authorized: warehouse.manage_returns'; end if; return private.warehouse_create_vendor_return(payload); end; $$;
create or replace function warehouse.submit_cycle_count(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'cycle_count') then raise exception 'Not authorized: warehouse.cycle_count'; end if; return private.warehouse_submit_cycle_count(payload); end; $$;
create or replace function warehouse.resolve_exception(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'resolve_exceptions') then raise exception 'Not authorized: warehouse.resolve_exceptions'; end if; return private.warehouse_resolve_exception(payload); end; $$;

revoke all on function warehouse.issue_uncertified_impl(jsonb), warehouse.record_return_uncertified_impl(jsonb), warehouse.record_cycle_count_uncertified_impl(jsonb), warehouse.receive_against_po_uncertified_impl(jsonb), warehouse.adjust_stock_uncertified_impl(jsonb), procurement.decide_request_step_uncertified_impl(jsonb), core.manage_finance_close_entry_uncertified_impl(jsonb), product.submit_readiness_package_uncertified_impl(jsonb), product.decide_readiness_package_uncertified_impl(jsonb), product.acknowledge_operations_handoff_uncertified_impl(jsonb), product.submit_price_proposal_uncertified_impl(jsonb), product.decide_price_proposal_uncertified_impl(jsonb), procurement.manage_replenishment_recommendation_uncertified_impl(jsonb), procurement.release_payment_uncertified_impl(jsonb), procurement.review_payment_readiness_uncertified_impl(jsonb), warehouse.register_export_job_uncertified_impl(jsonb), warehouse.review_export_job_uncertified_impl(jsonb), legal.approve_accreditation_case_uncertified_impl(jsonb) from public, anon, authenticated;
revoke all on function warehouse.issue(jsonb), warehouse.transfer(jsonb), warehouse.record_return(jsonb), warehouse.record_cycle_count(jsonb), warehouse.receive_against_po(jsonb), warehouse.adjust_stock(jsonb), warehouse.inspect_quality(jsonb), warehouse.release_quality_hold(jsonb), warehouse.create_vendor_return(jsonb), warehouse.submit_cycle_count(jsonb), warehouse.resolve_exception(jsonb), procurement.decide_request_step(jsonb), core.manage_finance_close_entry(jsonb), product.submit_readiness_package(jsonb), product.decide_readiness_package(jsonb), product.acknowledge_operations_handoff(jsonb), product.submit_price_proposal(jsonb), product.decide_price_proposal(jsonb), procurement.manage_replenishment_recommendation(jsonb), procurement.release_payment(jsonb), procurement.review_payment_readiness(jsonb), warehouse.register_export_job(jsonb), warehouse.review_export_job(jsonb), legal.approve_accreditation_case(jsonb) from public, anon;
grant execute on function warehouse.issue(jsonb), warehouse.transfer(jsonb), warehouse.record_return(jsonb), warehouse.record_cycle_count(jsonb), warehouse.receive_against_po(jsonb), warehouse.adjust_stock(jsonb), warehouse.inspect_quality(jsonb), warehouse.release_quality_hold(jsonb), warehouse.create_vendor_return(jsonb), warehouse.submit_cycle_count(jsonb), warehouse.resolve_exception(jsonb), procurement.decide_request_step(jsonb), core.manage_finance_close_entry(jsonb), product.submit_readiness_package(jsonb), product.decide_readiness_package(jsonb), product.acknowledge_operations_handoff(jsonb), product.submit_price_proposal(jsonb), product.decide_price_proposal(jsonb), procurement.manage_replenishment_recommendation(jsonb), procurement.release_payment(jsonb), procurement.review_payment_readiness(jsonb), warehouse.register_export_job(jsonb), warehouse.review_export_job(jsonb), legal.approve_accreditation_case(jsonb) to authenticated, service_role;

revoke all on function private.warehouse_update_operation_route(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_inspect_quality(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_release_quality_hold(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_create_vendor_return(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_submit_cycle_count(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_decide_stock_change(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_resolve_exception(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_transfer(jsonb) from public, anon, authenticated;
grant execute on function private.warehouse_update_operation_route(jsonb), private.warehouse_inspect_quality(jsonb), private.warehouse_release_quality_hold(jsonb), private.warehouse_create_vendor_return(jsonb), private.warehouse_submit_cycle_count(jsonb), private.warehouse_decide_stock_change(jsonb), private.warehouse_resolve_exception(jsonb), private.warehouse_transfer(jsonb) to service_role;

drop policy if exists finance_close_entries_read on core.finance_close_entries;
create policy finance_close_entries_read on core.finance_close_entries for select to authenticated using (core.has_live_cap('warehouse', 'manage_finance_close'));

alter table legal.accreditation_cases drop constraint if exists accreditation_cases_status_check;
alter table legal.accreditation_cases add constraint accreditation_cases_status_check check (status in ('draft','submitted','under_review','correction_requested','approved','provisional','rejected','expired','renewal_due'));

create table if not exists legal.document_access_audit (
  id uuid primary key default gen_random_uuid(), document_id text not null references legal.accreditation_docs(id) on delete restrict,
  case_id text not null references legal.accreditation_cases(id) on delete restrict, actor_id uuid not null references core.profiles(id) on delete restrict,
  purpose text not null, prepared_at timestamptz not null default now(), expires_at timestamptz not null
);
alter table legal.document_access_audit enable row level security;
create policy legal_document_access_audit_read on legal.document_access_audit for select to authenticated using (core.has_live_cap('legal', 'manage_documents'));

-- Legal reviewers receive a short-lived, audited preparation record instead of
-- broad direct object reads. Vendors retain only their own private folder.
drop policy if exists documents_auth_read on storage.objects;
create policy documents_auth_read on storage.objects for select to authenticated using (
  bucket_id = 'documents' and (
    owner = auth.uid() or ((storage.foldername(name))[1] = 'vendor' and (storage.foldername(name))[2] = core.current_vendor_id()::text)
  )
);

create or replace function legal.prepare_document_signed_access(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_document legal.accreditation_docs; v_audit legal.document_access_audit; v_purpose text := nullif(pg_catalog.btrim(payload->>'purpose'), '');
begin
  if auth.role() <> 'service_role' and not core.has_live_cap('legal', 'manage_documents') then raise exception 'Not authorized: legal.manage_documents'; end if;
  if v_purpose is null then raise exception 'Document access purpose is required'; end if;
  select * into v_document from legal.accreditation_docs where id = payload->>'document_id' for share;
  if not found or nullif(v_document.storage_path, '') is null then raise exception 'Accreditation document with private storage is required'; end if;
  insert into legal.document_access_audit(document_id, case_id, actor_id, purpose, expires_at) values (v_document.id, v_document.case_id, auth.uid(), v_purpose, now() + interval '300 seconds') returning * into v_audit;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail) values ('legal','accreditation_document',v_document.id,'signed_access_prepared',auth.uid(),jsonb_build_object('access_audit_id',v_audit.id,'purpose',v_purpose));
  return jsonb_build_object('storage_path',v_document.storage_path,'expires_in',300,'access_audit_id',v_audit.id);
end; $$;

create or replace function legal.request_vendor_application_correction(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_case legal.accreditation_cases; v_snapshot legal.vendor_application_snapshots; v_note text := nullif(pg_catalog.btrim(payload->>'note'), '');
begin
  if auth.role() <> 'service_role' and not core.has_live_cap('legal', 'review_accreditation') then raise exception 'Not authorized: legal.review_accreditation'; end if;
  if v_note is null then raise exception 'A correction note is required'; end if;
  select * into v_case from legal.accreditation_cases where id=payload->>'case_id' for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  if v_case.status not in ('submitted', 'under_review') then raise exception 'Only submitted or under-review applications can be corrected'; end if;
  select * into v_snapshot from legal.vendor_application_snapshots where case_id=v_case.id and status='submitted' order by version desc limit 1 for update;
  if not found then raise exception 'A latest submitted vendor application is required before correction'; end if;
  update legal.accreditation_cases set status='correction_requested', decision_note=v_note, updated_at=now() where id=v_case.id returning * into v_case;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail) values ('legal','vendor_application',v_case.id,'correction_requested',auth.uid(),jsonb_build_object('note',v_note,'submitted_snapshot_id',v_snapshot.id,'version',v_snapshot.version));
  return to_jsonb(v_case);
end; $$;

create or replace function private.policy_submit_vendor_application(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_case legal.accreditation_cases; v_snapshot legal.vendor_application_snapshots; v_application jsonb := payload->'application'; v_hash text; v_version integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_case from legal.accreditation_cases where id=payload->>'case_id' for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  if v_case.vendor_id is distinct from core.current_vendor_id() then raise exception 'Not authorized for this vendor'; end if;
  if v_case.status not in ('draft', 'correction_requested') then raise exception 'Only draft or correction-requested cases can be submitted'; end if;
  if v_application is null or jsonb_typeof(v_application)<>'object' then raise exception 'Vendor application payload is required'; end if;
  if nullif(pg_catalog.btrim(v_application->>'legal_name'),'') is null or nullif(pg_catalog.btrim(v_application->>'registration_number'),'') is null or jsonb_typeof(v_application->'primary_contact') <> 'object' or jsonb_typeof(v_application->'documents') <> 'array' or jsonb_array_length(v_application->'documents') = 0 then raise exception 'legal_name, registration_number, primary_contact, and documents are required'; end if;
  if coalesce(payload#>>'{declaration,accepted}','false')::boolean is not true or coalesce(payload#>>'{declaration,verificationAuthorized}','false')::boolean is not true or nullif(pg_catalog.btrim(payload#>>'{declaration,signerName}'),'') is null or nullif(pg_catalog.btrim(payload#>>'{declaration,signerTitle}'),'') is null then raise exception 'Signed declaration and verification authorization are required'; end if;
  if jsonb_typeof(payload->'signature')<>'object' then raise exception 'Signature is required'; end if;
  select coalesce(max(version),0) into v_version from legal.vendor_application_snapshots where case_id=v_case.id;
  v_hash := encode(digest(convert_to(jsonb_build_object('application',v_application,'declaration',payload->'declaration','signature',payload->'signature')::text,'UTF8'),'sha256'),'hex');
  update legal.vendor_application_snapshots set status='superseded',updated_at=now() where case_id=v_case.id and status in ('draft','submitted');
  insert into legal.vendor_application_snapshots(case_id,vendor_id,policy_id,policy_version,payload,document_hash,status,signed_by_name,signed_by_title,signature,signed_at,submitted_at,created_by,version,updated_at) values (v_case.id,v_case.vendor_id,'vendor-accreditation','2025',v_application,v_hash,'submitted',payload#>>'{declaration,signerName}',payload#>>'{declaration,signerTitle}',payload->'signature',now(),now(),auth.uid(),v_version+1,now()) returning * into v_snapshot;
  update legal.accreditation_cases set status='submitted',submitted_at=now(),decision_note=null,updated_at=now() where id=v_case.id;
  insert into legal.case_timeline(case_id,actor_email,action,detail) values(v_case.id,auth.jwt()->>'email','policy_application_submitted','Vendor Accreditation Form v.2025 snapshot ' || v_hash);
  return to_jsonb(v_snapshot);
end; $$;
create or replace function legal.submit_vendor_application(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('core', 'submit_accreditation') then raise exception 'Not authorized: core.submit_accreditation'; end if; return private.policy_submit_vendor_application(payload); end; $$;

revoke all on function legal.prepare_document_signed_access(jsonb), legal.request_vendor_application_correction(jsonb) from public, anon;
grant execute on function legal.prepare_document_signed_access(jsonb), legal.request_vendor_application_correction(jsonb) to authenticated, service_role;
revoke all on legal.document_access_audit from public, anon, authenticated;
grant select on legal.document_access_audit to authenticated;

select pg_notify('pgrst', 'reload schema');
