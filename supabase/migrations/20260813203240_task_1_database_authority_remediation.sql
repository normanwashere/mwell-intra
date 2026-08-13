-- Task 1 full-audit authority remediation. Forward-only: this migration wraps
-- every audited mutation boundary with certification-aware authority and leaves
-- historical migrations intact.

insert into core.capabilities(module, cap) values
  ('warehouse', 'recommend_replenishment'),
  ('procurement', 'manage_replenishment'),
  ('procurement', 'cancel_purchase_order'),
  ('procurement', 'release_payment'),
  ('procurement', 'review_payment_readiness'),
  ('warehouse', 'register_exports'),
  ('warehouse', 'review_exports')
on conflict (module, cap) do nothing;

insert into core.role_capabilities(module, role, cap) values
  ('warehouse', 'operations', 'recommend_replenishment'),
  ('warehouse', 'operations', 'register_exports'),
  ('warehouse', 'bi_analyst', 'register_exports'),
  ('warehouse', 'finance', 'register_exports'),
  ('warehouse', 'finance', 'review_exports'),
  ('procurement', 'procurement_officer', 'manage_replenishment'),
  ('procurement', 'admin', 'manage_replenishment'),
  ('procurement', 'procurement_officer', 'cancel_purchase_order'),
  ('procurement', 'admin', 'cancel_purchase_order'),
  ('procurement', 'finance', 'release_payment'),
  ('procurement', 'admin', 'release_payment'),
  ('procurement', 'finance', 'review_payment_readiness'),
  ('procurement', 'admin', 'review_payment_readiness')
on conflict (module, role, cap) do nothing;

insert into learning.mutation_capability_rules(module, capability) values
  ('core', 'manage_own_accreditation_draft'),
  ('warehouse', 'recommend_replenishment'),
  ('procurement', 'manage_replenishment'),
  ('procurement', 'cancel_purchase_order'),
  ('procurement', 'release_payment'),
  ('procurement', 'review_payment_readiness'),
  ('warehouse', 'register_exports'),
  ('warehouse', 'review_exports'),
  ('insights', 'prepare_exports')
on conflict (module, capability) do nothing;

-- Preserve current implementations behind unexposed names, then make the RPC
-- boundary certification-aware. The implementation owner remains postgres.
alter function warehouse.issue(jsonb) rename to issue_uncertified_impl;
alter function warehouse.record_return(jsonb) rename to record_return_uncertified_impl;
alter function warehouse.record_cycle_count(jsonb) rename to record_cycle_count_uncertified_impl;
alter function warehouse.receive_against_po(jsonb) rename to receive_against_po_uncertified_impl;
alter function warehouse.adjust_stock(jsonb) rename to adjust_stock_uncertified_impl;
alter function warehouse.reserve(jsonb) rename to reserve_uncertified_impl;
alter function warehouse.create_event(jsonb) rename to create_event_uncertified_impl;
alter function warehouse.request_event_fulfillment(jsonb) rename to request_event_fulfillment_uncertified_impl;
alter function warehouse.save_event_reconciliation(jsonb) rename to save_event_reconciliation_uncertified_impl;
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
create or replace function warehouse.reserve(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'reserve_allocate') then raise exception 'Not authorized: warehouse.reserve_allocate'; end if; return warehouse.reserve_uncertified_impl(payload); end; $$;
create or replace function warehouse.create_event(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('events', 'create_event') then raise exception 'Not authorized: events.create_event'; end if; return warehouse.create_event_uncertified_impl(payload); end; $$;
create or replace function warehouse.request_event_fulfillment(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('events', 'request_fulfillment') then raise exception 'Not authorized: events.request_fulfillment'; end if; return warehouse.request_event_fulfillment_uncertified_impl(payload); end; $$;

create table if not exists warehouse.event_settlements (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique references warehouse.events(id) on delete restrict,
  reconciliation_event_id text not null unique references warehouse.event_reconciliations(event_id) on delete restrict,
  finance_close_entry_id uuid not null unique references core.finance_close_entries(id) on delete restrict,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table warehouse.event_settlements enable row level security;
create policy event_settlements_read on warehouse.event_settlements for select to authenticated using (
  core.has_live_cap('events','approve_settlement') or core.has_live_cap('warehouse','manage_finance_close')
);
revoke insert, update, delete on warehouse.event_settlements from authenticated;
grant select on warehouse.event_settlements to authenticated;
grant all on warehouse.event_settlements to service_role;

create or replace function warehouse.save_event_reconciliation(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_action text:=payload->>'action';
  v_result jsonb;
  v_reconciliation warehouse.event_reconciliations;
  v_event warehouse.events;
  v_close core.finance_close_entries;
begin
  if auth.uid() is null then raise exception 'An attributable Event or Finance actor is required'; end if;
  if v_action in ('save','submit') then
    if not core.has_live_cap('events','manage_events') then raise exception 'Not authorized: events.manage_events'; end if;
  elsif v_action='approve' then
    if not core.has_live_cap('events','approve_settlement') then raise exception 'Not authorized: events.approve_settlement'; end if;
  else raise exception 'Unsupported reconciliation action'; end if;
  v_result:=warehouse.save_event_reconciliation_uncertified_impl(payload);
  if v_action='approve' then
    select * into v_reconciliation from warehouse.event_reconciliations where event_id=v_result->>'event_id' for update;
    select * into v_event from warehouse.events where id=v_reconciliation.event_id for share;
    insert into core.finance_close_entries(
      period_start,period_end,entry_type,source_module,source_reference,cost_center,
      amount,status,evidence_url,reconciliation_note,prepared_by,prepared_at,updated_at
    ) values (
      v_event.start_date,coalesce(v_event.end_date,v_event.start_date),'event_settlement','events',v_event.id,null,
      v_reconciliation.gross_sales_amount,'ready',v_reconciliation.evidence_url,v_reconciliation.note,
      v_reconciliation.prepared_by,coalesce(v_reconciliation.prepared_at,now()),now()
    ) on conflict(entry_type,source_module,source_reference,period_end) do update set
      amount=excluded.amount,evidence_url=excluded.evidence_url,reconciliation_note=excluded.reconciliation_note,updated_at=now()
    returning * into v_close;
    insert into warehouse.event_settlements(event_id,reconciliation_event_id,finance_close_entry_id,created_by)
    values(v_reconciliation.event_id,v_reconciliation.event_id,v_close.id,auth.uid())
    on conflict(event_id) do update set finance_close_entry_id=excluded.finance_close_entry_id
    returning finance_close_entry_id into v_close.id;
    v_result:=to_jsonb(v_reconciliation)||jsonb_build_object('finance_close_entry_id',v_close.id);
  end if;
  return v_result;
end; $$;
create or replace function procurement.decide_request_step(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('procurement', 'approve_request') then raise exception 'Not authorized: procurement.approve_request'; end if; return procurement.decide_request_step_uncertified_impl(payload); end; $$;
alter table core.finance_close_entries
  add column if not exists reconciled_by uuid references core.profiles(id) on delete restrict,
  add column if not exists reconciled_at timestamptz;

create or replace function core.manage_finance_close_entry(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_entry core.finance_close_entries; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated Finance actor required'; end if;
  if not core.has_live_cap('warehouse', 'manage_finance_close') then raise exception 'Not authorized: warehouse.manage_finance_close'; end if;
  if payload->>'action' = 'reconcile' then
    select * into v_entry from core.finance_close_entries where id=(payload->>'id')::uuid for update;
    if not found then raise exception 'Finance close entry not found'; end if;
    if v_entry.posted_by = auth.uid() then raise exception 'A third Finance user must reconcile the posted entry'; end if;
    if v_entry.prepared_by = auth.uid() then raise exception 'The preparer cannot reconcile their own entry'; end if;
  end if;
  v_result := core.manage_finance_close_entry_uncertified_impl(payload);
  if payload->>'action' = 'reconcile' then
    update core.finance_close_entries
    set reconciled_by=auth.uid(), reconciled_at=now(), updated_at=now()
    where id=(v_result->>'id')::uuid returning * into v_entry;
    return to_jsonb(v_entry);
  end if;
  return v_result;
end; $$;
create or replace function product.submit_readiness_package(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('product', 'prepare_readiness') then raise exception 'Not authorized: product.prepare_readiness'; end if; return product.submit_readiness_package_uncertified_impl(payload); end; $$;
create or replace function product.decide_readiness_package(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row product.readiness_packages; v_expected_version integer;
begin
  if auth.uid() is null then raise exception 'Authenticated Product decision actor required'; end if;
  if not core.has_live_cap('product', 'decide_go_live') then raise exception 'Not authorized: product.decide_go_live'; end if;
  if nullif(payload->>'expected_version','') is null then raise exception 'expected_version is required'; end if;
  v_expected_version := (payload->>'expected_version')::integer;
  select * into v_row from product.readiness_packages where id=(payload->>'id')::uuid for update;
  if not found then raise exception 'Readiness package not found'; end if;
  if v_row.version <> v_expected_version then raise exception 'Readiness package version changed; refresh and try again'; end if;
  return product.decide_readiness_package_uncertified_impl(payload);
end; $$;
create or replace function product.acknowledge_operations_handoff(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('product', 'acknowledge_operations_handoff') then raise exception 'Not authorized: product.acknowledge_operations_handoff'; end if; return product.acknowledge_operations_handoff_uncertified_impl(payload); end; $$;
create or replace function product.submit_price_proposal(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('product', 'propose_pricing') then raise exception 'Not authorized: product.propose_pricing'; end if; return product.submit_price_proposal_uncertified_impl(payload); end; $$;
create or replace function product.decide_price_proposal(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('product', 'approve_pricing') then raise exception 'Not authorized: product.approve_pricing'; end if; return product.decide_price_proposal_uncertified_impl(payload); end; $$;
create or replace function procurement.manage_replenishment_recommendation(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_action text := payload->>'action';
begin
  if v_action = 'recommend' then
    if not core.has_live_cap('warehouse', 'recommend_replenishment') then raise exception 'Not authorized: warehouse.recommend_replenishment'; end if;
  elsif not core.has_live_cap('procurement', 'manage_replenishment') then
    raise exception 'Not authorized: procurement.manage_replenishment';
  end if;
  return procurement.manage_replenishment_recommendation_uncertified_impl(payload);
end; $$;
create or replace function procurement.release_payment(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('procurement', 'release_payment') then raise exception 'Not authorized: procurement.release_payment'; end if; return procurement.release_payment_uncertified_impl(payload); end; $$;
create or replace function procurement.review_payment_readiness(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('procurement', 'review_payment_readiness') then raise exception 'Not authorized: procurement.review_payment_readiness'; end if; return procurement.review_payment_readiness_uncertified_impl(payload); end; $$;
create or replace function warehouse.register_export_job(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not (core.has_live_cap('warehouse', 'register_exports') or core.has_live_cap('insights', 'prepare_exports')) then raise exception 'Not authorized: governed export preparation'; end if; return warehouse.register_export_job_uncertified_impl(payload); end; $$;
create or replace function warehouse.review_export_job(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'review_exports') then raise exception 'Not authorized: warehouse.review_exports'; end if; return warehouse.review_export_job_uncertified_impl(payload); end; $$;
create or replace function legal.approve_accreditation_case(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('legal', 'approve_accreditation') then raise exception 'Not authorized: legal.approve_accreditation'; end if; return legal.approve_accreditation_case_uncertified_impl(payload); end; $$;

create or replace function warehouse.transfer(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'transfer_stock') then raise exception 'Not authorized: warehouse.transfer_stock'; end if; return private.warehouse_transfer(payload); end; $$;
create or replace function warehouse.inspect_quality(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'inspect_quality') then raise exception 'Not authorized: warehouse.inspect_quality'; end if; return private.warehouse_inspect_quality(payload); end; $$;
create or replace function warehouse.release_quality_hold(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'release_quality_hold') then raise exception 'Not authorized: warehouse.release_quality_hold'; end if; return private.warehouse_release_quality_hold(payload); end; $$;
create or replace function warehouse.create_vendor_return(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'manage_returns') then raise exception 'Not authorized: warehouse.manage_returns'; end if; return private.warehouse_create_vendor_return(payload); end; $$;
create or replace function warehouse.submit_cycle_count(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'cycle_count') then raise exception 'Not authorized: warehouse.cycle_count'; end if; return private.warehouse_submit_cycle_count(payload); end; $$;
create or replace function warehouse.resolve_exception(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('warehouse', 'resolve_exceptions') then raise exception 'Not authorized: warehouse.resolve_exceptions'; end if; return private.warehouse_resolve_exception(payload); end; $$;

revoke all on function warehouse.issue_uncertified_impl(jsonb), warehouse.reserve_uncertified_impl(jsonb), warehouse.create_event_uncertified_impl(jsonb), warehouse.request_event_fulfillment_uncertified_impl(jsonb), warehouse.save_event_reconciliation_uncertified_impl(jsonb), warehouse.record_return_uncertified_impl(jsonb), warehouse.record_cycle_count_uncertified_impl(jsonb), warehouse.receive_against_po_uncertified_impl(jsonb), warehouse.adjust_stock_uncertified_impl(jsonb), procurement.decide_request_step_uncertified_impl(jsonb), core.manage_finance_close_entry_uncertified_impl(jsonb), product.submit_readiness_package_uncertified_impl(jsonb), product.decide_readiness_package_uncertified_impl(jsonb), product.acknowledge_operations_handoff_uncertified_impl(jsonb), product.submit_price_proposal_uncertified_impl(jsonb), product.decide_price_proposal_uncertified_impl(jsonb), procurement.manage_replenishment_recommendation_uncertified_impl(jsonb), procurement.release_payment_uncertified_impl(jsonb), procurement.review_payment_readiness_uncertified_impl(jsonb), warehouse.register_export_job_uncertified_impl(jsonb), warehouse.review_export_job_uncertified_impl(jsonb), legal.approve_accreditation_case_uncertified_impl(jsonb) from public, anon, authenticated;
revoke all on function warehouse.issue(jsonb), warehouse.transfer(jsonb), warehouse.record_return(jsonb), warehouse.record_cycle_count(jsonb), warehouse.receive_against_po(jsonb), warehouse.adjust_stock(jsonb), warehouse.inspect_quality(jsonb), warehouse.release_quality_hold(jsonb), warehouse.create_vendor_return(jsonb), warehouse.submit_cycle_count(jsonb), warehouse.resolve_exception(jsonb), procurement.decide_request_step(jsonb), core.manage_finance_close_entry(jsonb), product.submit_readiness_package(jsonb), product.decide_readiness_package(jsonb), product.acknowledge_operations_handoff(jsonb), product.submit_price_proposal(jsonb), product.decide_price_proposal(jsonb), procurement.manage_replenishment_recommendation(jsonb), procurement.release_payment(jsonb), procurement.review_payment_readiness(jsonb), warehouse.register_export_job(jsonb), warehouse.review_export_job(jsonb), legal.approve_accreditation_case(jsonb) from public, anon;
grant execute on function warehouse.issue(jsonb), warehouse.transfer(jsonb), warehouse.record_return(jsonb), warehouse.record_cycle_count(jsonb), warehouse.receive_against_po(jsonb), warehouse.adjust_stock(jsonb), warehouse.inspect_quality(jsonb), warehouse.release_quality_hold(jsonb), warehouse.create_vendor_return(jsonb), warehouse.submit_cycle_count(jsonb), warehouse.resolve_exception(jsonb), procurement.decide_request_step(jsonb), core.manage_finance_close_entry(jsonb), product.submit_readiness_package(jsonb), product.decide_readiness_package(jsonb), product.acknowledge_operations_handoff(jsonb), product.submit_price_proposal(jsonb), product.decide_price_proposal(jsonb), procurement.manage_replenishment_recommendation(jsonb), procurement.release_payment(jsonb), procurement.review_payment_readiness(jsonb), warehouse.register_export_job(jsonb), warehouse.review_export_job(jsonb), legal.approve_accreditation_case(jsonb) to authenticated, service_role;
revoke all on function warehouse.reserve(jsonb), warehouse.create_event(jsonb), warehouse.request_event_fulfillment(jsonb), warehouse.save_event_reconciliation(jsonb) from public, anon;
grant execute on function warehouse.reserve(jsonb), warehouse.create_event(jsonb), warehouse.request_event_fulfillment(jsonb), warehouse.save_event_reconciliation(jsonb) to authenticated, service_role;

revoke all on function private.warehouse_update_operation_route(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_inspect_quality(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_release_quality_hold(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_create_vendor_return(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_submit_cycle_count(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_decide_stock_change(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_resolve_exception(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_transfer(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_apply_import_job(jsonb) from public, anon, authenticated;
grant execute on function private.warehouse_update_operation_route(jsonb), private.warehouse_inspect_quality(jsonb), private.warehouse_release_quality_hold(jsonb), private.warehouse_create_vendor_return(jsonb), private.warehouse_submit_cycle_count(jsonb), private.warehouse_decide_stock_change(jsonb), private.warehouse_resolve_exception(jsonb), private.warehouse_transfer(jsonb) to service_role;
grant execute on function private.warehouse_apply_import_job(jsonb) to service_role;

create or replace function warehouse.update_operation_route(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role() <> 'service_role' and not core.has_live_cap('warehouse','manage_operation_routes') then raise exception 'Not authorized: warehouse.manage_operation_routes'; end if;
  return private.warehouse_update_operation_route(payload);
end; $$;
create or replace function warehouse.apply_import_job(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role() <> 'service_role' and not core.has_live_cap('warehouse','import_warehouse_data') then raise exception 'Not authorized: warehouse.import_warehouse_data'; end if;
  return private.warehouse_apply_import_job(payload);
end; $$;
revoke all on function warehouse.update_operation_route(jsonb), warehouse.apply_import_job(jsonb) from public, anon;
grant execute on function warehouse.update_operation_route(jsonb), warehouse.apply_import_job(jsonb) to authenticated, service_role;

create or replace function warehouse.create_kit_definition(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' and not core.has_live_cap('warehouse','manage_products') then raise exception 'Not authorized: warehouse.manage_products'; end if;
  if payload->>'status'='active' and not product.can_launch(payload->>'product_id') then
    raise exception 'Product readiness approval and Operations acknowledgement are required before active kit creation';
  end if;
  return private.warehouse_create_kit_definition(payload);
end; $$;
revoke all on function private.warehouse_create_kit_definition(jsonb) from public,anon,authenticated;
grant execute on function private.warehouse_create_kit_definition(jsonb) to service_role;
revoke all on function warehouse.create_kit_definition(jsonb) from public,anon;
grant execute on function warehouse.create_kit_definition(jsonb) to authenticated,service_role;

drop policy if exists finance_close_entries_read on core.finance_close_entries;
create policy finance_close_entries_read on core.finance_close_entries for select to authenticated using (core.has_live_cap('warehouse', 'manage_finance_close'));

alter table procurement.purchase_orders
  add column if not exists cancellation_version integer not null default 1,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_by uuid references core.profiles(id) on delete restrict,
  add column if not exists cancelled_at timestamptz,
  add column if not exists issued_at timestamptz;

create table if not exists procurement.purchase_order_cancellation_commands (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references core.profiles(id) on delete restrict,
  idempotency_key text not null,
  purchase_order_id text not null references procurement.purchase_orders(id) on delete restrict,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key)
);
alter table procurement.purchase_order_cancellation_commands enable row level security;
revoke all on procurement.purchase_order_cancellation_commands from public,anon,authenticated;
grant all on procurement.purchase_order_cancellation_commands to service_role;

create or replace function procurement.cancel_purchase_order(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_po procurement.purchase_orders;
  v_prior procurement.purchase_order_cancellation_commands;
  v_actor uuid:=auth.uid();
  v_key text:=nullif(pg_catalog.btrim(payload->>'idempotency_key'),'');
  v_reason text:=nullif(pg_catalog.btrim(payload->>'reason'),'');
  v_expected integer;
  v_blockers jsonb:='[]'::jsonb;
  v_response jsonb;
begin
  if v_actor is null then raise exception 'An attributable Procurement actor is required'; end if;
  if not core.has_live_cap('procurement','cancel_purchase_order') then raise exception 'Not authorized: procurement.cancel_purchase_order'; end if;
  if v_key is null then raise exception 'idempotency_key is required'; end if;
  if v_reason is null or pg_catalog.char_length(v_reason)<8 then raise exception 'Cancellation reason must contain at least 8 characters'; end if;
  if nullif(payload->>'expected_version','') is null then raise exception 'expected_version is required'; end if;
  v_expected:=(payload->>'expected_version')::integer;
  select * into v_prior from procurement.purchase_order_cancellation_commands
  where actor_id=v_actor and idempotency_key=v_key;
  if found then
    if v_prior.purchase_order_id is distinct from payload->>'id' then raise exception 'idempotency_key is already bound to another purchase order'; end if;
    return v_prior.response;
  end if;
  select * into v_po from procurement.purchase_orders where id=payload->>'id' for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_po.cancellation_version<>v_expected then raise exception 'Purchase order version changed; refresh and try again'; end if;
  if v_po.status in ('closed','cancelled') then raise exception 'Closed or cancelled purchase orders cannot be cancelled'; end if;
  if exists(select 1 from procurement.receipts where purchase_order_id=v_po.id) then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('type','procurement_receipt','recovery','Reverse or reconcile the receipt before cancellation'));
  end if;
  if exists(select 1 from warehouse.receipts where procurement_po_id=v_po.id) then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('type','warehouse_receipt','recovery','Resolve Warehouse custody before cancellation'));
  end if;
  if exists(select 1 from procurement.acceptance_packs where purchase_order_id=v_po.id and status<>'superseded') then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('type','acceptance','recovery','Supersede active acceptance evidence before cancellation'));
  end if;
  if exists(select 1 from procurement.payment_readiness_packs where purchase_order_id=v_po.id and status<>'superseded') then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('type','payment_readiness','recovery','Return or supersede payment readiness before cancellation'));
  end if;
  if exists(select 1 from procurement.payment_releases where purchase_order_id=v_po.id and status='posted') then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('type','payment_release','recovery','Void or recover the posted payment before cancellation'));
  end if;
  if jsonb_array_length(v_blockers)>0 then
    v_response:=to_jsonb(v_po)||jsonb_build_object('cancelled',false,'blockers',v_blockers,'recovery_required',true);
    insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
    values('procurement','purchase_order',v_po.id,'cancellation_blocked',v_actor,jsonb_build_object('reason',v_reason,'blockers',v_blockers));
  else
    update procurement.purchase_orders set status='cancelled',cancellation_reason=v_reason,
      cancelled_by=v_actor,cancelled_at=now(),cancellation_version=cancellation_version+1,updated_at=now()
    where id=v_po.id and cancellation_version=v_expected returning * into v_po;
    if not found then raise exception 'Purchase order version changed; refresh and try again'; end if;
    v_response:=to_jsonb(v_po)||jsonb_build_object('cancelled',true,'blockers','[]'::jsonb,'recovery_required',false);
    insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
    values('procurement','purchase_order',v_po.id,'cancelled',v_actor,jsonb_build_object('reason',v_reason,'version',v_po.cancellation_version));
  end if;
  insert into procurement.purchase_order_cancellation_commands(actor_id,idempotency_key,purchase_order_id,response)
  values(v_actor,v_key,v_po.id,v_response);
  return v_response;
end; $$;
revoke all on function procurement.cancel_purchase_order(jsonb) from public,anon;
grant execute on function procurement.cancel_purchase_order(jsonb) to authenticated,service_role;

alter function procurement.issue_purchase_order(jsonb) rename to issue_purchase_order_pre_task1;
create or replace function procurement.issue_purchase_order(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_po procurement.purchase_orders;
begin
  if auth.role()<>'service_role' and not core.has_live_cap('procurement','author_po') then raise exception 'Not authorized: procurement.author_po'; end if;
  v_result:=procurement.issue_purchase_order_pre_task1(payload);
  update procurement.purchase_orders set issued_at=coalesce(issued_at,now()) where id=v_result->>'id' returning * into v_po;
  return to_jsonb(v_po);
end; $$;
revoke all on function procurement.issue_purchase_order_pre_task1(jsonb) from public,anon,authenticated;
revoke all on function procurement.issue_purchase_order(jsonb) from public,anon;
grant execute on function procurement.issue_purchase_order(jsonb) to authenticated,service_role;

alter table legal.accreditation_cases drop constraint if exists accreditation_cases_status_check;
alter table legal.accreditation_cases add constraint accreditation_cases_status_check check (status in ('draft','submitted','under_review','correction_requested','approved','provisional','rejected','expired','renewal_due'));

create table if not exists legal.document_access_audit (
  id uuid primary key default gen_random_uuid(), document_id text not null references legal.accreditation_docs(id) on delete restrict,
  case_id text not null references legal.accreditation_cases(id) on delete restrict, actor_id uuid references core.profiles(id) on delete restrict,
  actor_role text not null,
  purpose text not null, prepared_at timestamptz not null default now(), expires_at timestamptz not null
);
alter table legal.document_access_audit enable row level security;
create policy legal_document_access_audit_read on legal.document_access_audit for select to authenticated using (core.has_live_cap('legal', 'manage_documents'));

alter table legal.accreditation_cases
  add column if not exists correction_source_version integer,
  add column if not exists correction_revision integer,
  add column if not exists correction_requested_at timestamptz,
  add column if not exists correction_requested_by uuid references core.profiles(id) on delete set null;

alter table legal.vendor_application_snapshots
  add column if not exists correction_source_version integer,
  add column if not exists correction_revision integer;

-- The shared private bucket has no authenticated raw-read path. Authenticated
-- callers authorize and audit through Legal; only a server-held service client
-- may consume the returned path to create the bounded signed URL.
drop policy if exists documents_auth_read on storage.objects;
create policy documents_auth_read on storage.objects for select to authenticated using (false);

create or replace function legal.prepare_document_signed_access(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_document legal.accreditation_docs; v_audit legal.document_access_audit; v_purpose text := nullif(pg_catalog.btrim(payload->>'purpose'), '');
begin
  if auth.uid() is null and auth.role() <> 'service_role' then raise exception 'Authentication required'; end if;
  if v_purpose is null then raise exception 'Document access purpose is required'; end if;
  select * into v_document from legal.accreditation_docs where id = payload->>'document_id' for share;
  if not found or nullif(v_document.storage_path, '') is null then raise exception 'Accreditation document with private storage is required'; end if;
  if auth.role() <> 'service_role'
    and not core.has_live_cap('legal', 'manage_documents')
    and v_document.vendor_id is distinct from core.current_vendor_id()
  then
    raise exception 'Not authorized for this accreditation document';
  end if;
  insert into legal.document_access_audit(document_id, case_id, actor_id, actor_role, purpose, expires_at)
  values (v_document.id, v_document.case_id, auth.uid(), auth.role(), v_purpose, now() + interval '300 seconds') returning * into v_audit;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail) values ('legal','accreditation_document',v_document.id,'signed_access_prepared',auth.uid(),jsonb_build_object('access_audit_id',v_audit.id,'purpose',v_purpose));
  return jsonb_build_object('storage_path',v_document.storage_path,'expires_in',300,'access_audit_id',v_audit.id);
end; $$;

create or replace function private.save_vendor_application_draft(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_case legal.accreditation_cases;
  v_existing legal.vendor_application_snapshots;
  v_saved legal.vendor_application_snapshots;
  v_application jsonb := payload->'application';
  v_expected integer;
  v_current integer;
  v_next integer;
  v_idempotency_key text := nullif(pg_catalog.btrim(payload->>'idempotency_key'),'');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(payload->>'expected_version','') is null then raise exception 'expected_version is required'; end if;
  v_expected := (payload->>'expected_version')::integer;
  if v_idempotency_key is null then raise exception 'idempotency_key is required'; end if;
  if v_application is null or jsonb_typeof(v_application) <> 'object' then raise exception 'Vendor application payload is required'; end if;
  select * into v_case from legal.accreditation_cases where id=payload->>'case_id' for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  if v_case.vendor_id is distinct from core.current_vendor_id() then raise exception 'Not authorized for this vendor'; end if;
  if v_case.status not in ('draft','correction_requested') then raise exception 'Only draft or correction-requested cases can be edited'; end if;
  select * into v_existing from legal.vendor_application_snapshots
  where created_by=auth.uid() and idempotency_key=v_idempotency_key;
  if found then return to_jsonb(v_existing); end if;
  select coalesce(max(version),0) into v_current from legal.vendor_application_snapshots where case_id=v_case.id;
  if v_current <> v_expected then raise exception 'Vendor application draft changed; refresh and try again'; end if;
  if v_case.status='correction_requested' then
    if v_case.correction_source_version is null or v_case.correction_revision is null then raise exception 'Correction source binding is missing'; end if;
    if v_current < v_case.correction_source_version then raise exception 'Correction source version is stale'; end if;
    v_next := greatest(v_current + 1, v_case.correction_revision);
  else
    v_next := v_current + 1;
  end if;
  update legal.vendor_application_snapshots set status='superseded',updated_at=now()
  where case_id=v_case.id and status='draft';
  insert into legal.vendor_application_snapshots(
    case_id,vendor_id,policy_id,policy_version,payload,document_hash,status,signature,
    created_by,version,updated_at,idempotency_key,correction_source_version,correction_revision
  ) values (
    v_case.id,v_case.vendor_id,'vendor-accreditation','2025',v_application,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_application::text,'UTF8'),'sha256'),'hex'),
    'draft','{}'::jsonb,auth.uid(),v_next,now(),v_idempotency_key,
    v_case.correction_source_version,case when v_case.status='correction_requested' then v_next else null end
  ) returning * into v_saved;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('legal','vendor_application',v_case.id,'draft_saved',auth.uid(),jsonb_build_object(
    'version',v_saved.version,'snapshot_id',v_saved.id,'correction_source_version',v_saved.correction_source_version));
  return to_jsonb(v_saved);
end; $$;

create or replace function private.discard_vendor_application_draft(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_case legal.accreditation_cases; v_draft legal.vendor_application_snapshots; v_expected integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(payload->>'expected_version','') is null then raise exception 'expected_version is required'; end if;
  v_expected := (payload->>'expected_version')::integer;
  select * into v_case from legal.accreditation_cases where id=payload->>'case_id' for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  if v_case.vendor_id is distinct from core.current_vendor_id() then raise exception 'Not authorized for this vendor'; end if;
  if v_case.status not in ('draft','correction_requested') then raise exception 'Only draft or correction-requested cases can discard a draft'; end if;
  select * into v_draft from legal.vendor_application_snapshots
  where case_id=v_case.id and status='draft' order by version desc limit 1 for update;
  if not found then return null; end if;
  if v_draft.version <> v_expected then raise exception 'Vendor application draft changed; refresh and try again'; end if;
  if v_case.status='correction_requested' and v_draft.correction_source_version is distinct from v_case.correction_source_version then
    raise exception 'Correction draft source binding changed; refresh and try again';
  end if;
  if v_case.status='correction_requested' and v_draft.correction_revision is distinct from v_draft.version then
    raise exception 'Correction draft revision binding changed; refresh and try again';
  end if;
  update legal.vendor_application_snapshots set status='superseded',discarded_at=now(),updated_at=now()
  where id=v_draft.id returning * into v_draft;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('legal','vendor_application',v_case.id,'draft_discarded',auth.uid(),jsonb_build_object(
    'version',v_draft.version,'snapshot_id',v_draft.id,'correction_source_version',v_draft.correction_source_version));
  return to_jsonb(v_draft);
end; $$;

create or replace function legal.save_vendor_application_draft(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' and not core.has_live_cap('core','manage_own_accreditation_draft') then raise exception 'Not authorized: core.manage_own_accreditation_draft'; end if;
  return private.save_vendor_application_draft(payload);
end; $$;
create or replace function legal.discard_vendor_application_draft(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' and not core.has_live_cap('core','manage_own_accreditation_draft') then raise exception 'Not authorized: core.manage_own_accreditation_draft'; end if;
  return private.discard_vendor_application_draft(payload);
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
  update legal.accreditation_cases
  set status='correction_requested',
      decision_note=v_note,
      correction_source_version=v_snapshot.version,
      correction_revision=v_snapshot.version + 1,
      correction_requested_at=now(),
      correction_requested_by=auth.uid(),
      updated_at=now()
  where id=v_case.id returning * into v_case;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail) values ('legal','vendor_application',v_case.id,'correction_requested',auth.uid(),jsonb_build_object('note',v_note,'submitted_snapshot_id',v_snapshot.id,'version',v_snapshot.version));
  return to_jsonb(v_case);
end; $$;

create or replace function private.policy_submit_vendor_application(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_case legal.accreditation_cases;
  v_snapshot legal.vendor_application_snapshots;
  v_application jsonb := payload->'application';
  v_declaration jsonb;
  v_hash text;
  v_version integer;
  v_expected integer;
  v_idempotency_key text := nullif(pg_catalog.btrim(payload->>'idempotency_key'),'');
  v_path text[];
  v_disposition jsonb;
  v_qualification jsonb;
  v_missing_documents integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(payload->>'expected_version','') is null then raise exception 'expected_version is required'; end if;
  v_expected := (payload->>'expected_version')::integer;
  if v_idempotency_key is null then raise exception 'idempotency_key is required'; end if;
  select * into v_snapshot from legal.vendor_application_snapshots
  where created_by=auth.uid() and idempotency_key=v_idempotency_key;
  if found then
    if v_snapshot.case_id is distinct from payload->>'case_id' then raise exception 'idempotency_key is already bound to another case'; end if;
    select * into v_case from legal.accreditation_cases where id=v_snapshot.case_id;
    return jsonb_build_object('snapshot',to_jsonb(v_snapshot),'case',to_jsonb(v_case),'replayed',true);
  end if;
  select * into v_case from legal.accreditation_cases where id=payload->>'case_id' for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  if v_case.vendor_id is distinct from core.current_vendor_id() then raise exception 'Not authorized for this vendor'; end if;
  if v_case.status not in ('draft','correction_requested') then raise exception 'Only draft or correction-requested cases can be submitted'; end if;
  select coalesce(max(version),0) into v_version from legal.vendor_application_snapshots where case_id=v_case.id;
  if v_version <> v_expected then raise exception 'Vendor application changed; refresh and try again'; end if;
  if v_case.status='correction_requested' and v_case.correction_source_version is null then raise exception 'Correction source binding is missing'; end if;
  if v_application is null or jsonb_typeof(v_application)<>'object' then raise exception 'Vendor application payload is required'; end if;
  if v_application->>'policyVersion' is distinct from 'vendor-accreditation-v2025' then raise exception 'Vendor Accreditation v2025 payload is required'; end if;
  if v_application->>'entityType' not in ('corporation','sole_prop','partnership')
     or v_application->>'jurisdiction' not in ('PH','US','EU','UK','SG','HK','OTHER') then
    raise exception 'Supported entityType and jurisdiction are required';
  end if;
  if jsonb_typeof(v_application->'company')<>'object' or jsonb_typeof(v_application->'manpower')<>'object'
     or jsonb_typeof(v_application->'fieldDispositions')<>'object' then raise exception 'Company, manpower, and field dispositions are required'; end if;
  foreach v_path slice 1 in array array[
    array['company','tradeName'],array['company','contactNumber'],array['company','businessAddress'],
    array['company','incorporationDate'],array['company','incorporationPlace'],array['company','tin'],
    array['company','email'],array['company','website'],array['company','principalName'],
    array['company','principalEmail'],array['company','principalContactNumber'],
    array['company','correspondenceName'],array['company','correspondenceEmail'],
    array['company','correspondenceContactNumber'],array['company','productsOrServices'],
    array['company','businessType'],array['manpower','countAndExpertise'],
    array['manpower','qualifications'],array['manpower','completedProjects']
  ]::text[][] loop
    if nullif(pg_catalog.btrim(v_application#>>v_path),'') is null then
      v_disposition := v_application->'fieldDispositions'->array_to_string(v_path,'.');
      if v_disposition->>'status' is distinct from 'not_applicable'
         or nullif(pg_catalog.btrim(v_disposition->>'reason'),'') is null then
        raise exception 'Required v2025 field is incomplete: %',array_to_string(v_path,'.');
      end if;
    end if;
  end loop;
  if v_application#>>'{company,businessType}' is distinct from v_application->>'entityType' then raise exception 'Company business type must match entity type'; end if;
  if jsonb_typeof(v_application->'technologyQualifications')<>'array' then raise exception 'technologyQualifications must be an array'; end if;
  if coalesce((v_application->>'technologyServiceProvider')::boolean,false) and jsonb_array_length(v_application->'technologyQualifications')=0 then
    raise exception 'Technology service providers require qualifications';
  end if;
  for v_qualification in select value from jsonb_array_elements(v_application->'technologyQualifications') loop
    if v_qualification->>'pool' not in ('nodejs','php_laravel','mobile')
       or jsonb_typeof(v_qualification->'qualified')<>'boolean'
       or nullif(pg_catalog.btrim(v_qualification->>'remarks'),'') is null then
      raise exception 'Every technology qualification requires pool, decision, and remarks';
    end if;
  end loop;
  v_declaration := v_application->'declaration';
  if jsonb_typeof(v_declaration)<>'object' or payload->'declaration' is distinct from v_declaration then raise exception 'Authoritative nested declaration mismatch'; end if;
  if coalesce((v_declaration->>'accepted')::boolean,false) is not true
     or coalesce((v_declaration->>'verificationAuthorized')::boolean,false) is not true
     or nullif(pg_catalog.btrim(v_declaration->>'signerName'),'') is null
     or nullif(pg_catalog.btrim(v_declaration->>'signerTitle'),'') is null
     or nullif(pg_catalog.btrim(v_declaration->>'signedAt'),'') is null
     or (coalesce((v_declaration->>'noLegalActions')::boolean,false) is false
         and nullif(pg_catalog.btrim(v_declaration->>'disclosureDetails'),'') is null) then
    raise exception 'Complete signed v2025 declaration is required';
  end if;
  if jsonb_typeof(payload->'signature')<>'object'
     or payload#>>'{signature,method}' not in ('drawn','typed')
     or nullif(pg_catalog.btrim(payload#>>'{signature,dataUrl}'),'') is null
     or nullif(pg_catalog.btrim(payload#>>'{signature,signerName}'),'') is null
     or nullif(pg_catalog.btrim(payload#>>'{signature,signedAt}'),'') is null then raise exception 'Complete signature evidence is required'; end if;
  select count(*) into v_missing_documents
  from legal.requirement_checklist_items item
  where item.case_id=v_case.id and item.required and not item.instrument
    and not exists (
      select 1 from legal.accreditation_docs document
      where document.case_id=v_case.id
        and (document.requirement_id=item.id or document.id=any(item.document_ids))
        and document.status not in ('rejected','superseded')
        and nullif(document.storage_path,'') is not null
    );
  if v_missing_documents>0 then raise exception 'Authoritative checklist has % required document item(s) without current evidence',v_missing_documents; end if;
  v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    jsonb_build_object('application',v_application,'declaration',v_declaration,'signature',payload->'signature')::text,'UTF8'),'sha256'),'hex');
  update legal.vendor_application_snapshots set status='superseded',updated_at=now()
  where case_id=v_case.id and status in ('draft','submitted');
  insert into legal.vendor_application_snapshots(
    case_id,vendor_id,policy_id,policy_version,payload,document_hash,status,
    signed_by_name,signed_by_title,signature,signed_at,submitted_at,created_by,
    version,updated_at,idempotency_key,correction_source_version,correction_revision
  ) values (
    v_case.id,v_case.vendor_id,'vendor-accreditation','2025',v_application,v_hash,'submitted',
    v_declaration->>'signerName',v_declaration->>'signerTitle',payload->'signature',now(),now(),auth.uid(),
    v_version+1,now(),v_idempotency_key,v_case.correction_source_version,
    case when v_case.status='correction_requested' then v_version+1 else null end
  ) returning * into v_snapshot;
  update legal.accreditation_cases set status='submitted',submitted_at=now(),decision_note=null,
    correction_source_version=null,correction_revision=null,correction_requested_at=null,
    correction_requested_by=null,updated_at=now() where id=v_case.id returning * into v_case;
  insert into legal.case_timeline(case_id,actor_email,action,detail)
  values(v_case.id,auth.jwt()->>'email','policy_application_submitted','Vendor Accreditation Form v.2025 snapshot ' || v_hash);
  return jsonb_build_object('snapshot',to_jsonb(v_snapshot),'case',to_jsonb(v_case),'replayed',false);
end; $$;
create or replace function legal.submit_vendor_application(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin if auth.role() <> 'service_role' and not core.has_live_cap('core', 'submit_accreditation') then raise exception 'Not authorized: core.submit_accreditation'; end if; return private.policy_submit_vendor_application(payload); end; $$;

alter table legal.vendor_lifecycle_reviews
  drop constraint if exists vendor_lifecycle_reviews_review_type_check;
alter table legal.vendor_lifecycle_reviews
  add constraint vendor_lifecycle_reviews_review_type_check check (
    review_type in ('renewal','document_expiry','performance','reassessment','suspension','offboarding','reinstatement')
  );

create or replace function legal.manage_vendor_lifecycle_review(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_review legal.vendor_lifecycle_reviews; v_vendor core.vendors; v_action text:=payload->>'action'; v_actor uuid:=auth.uid();
begin
  if v_actor is null then raise exception 'An attributable lifecycle actor is required, including for service_role calls'; end if;
  if not core.has_live_cap('legal','review_accreditation') then raise exception 'Not authorized: legal.review_accreditation'; end if;
  if v_action='open' then
    if payload->>'review_type' not in ('renewal','document_expiry','performance','reassessment','suspension','offboarding','reinstatement')
       or nullif(pg_catalog.btrim(payload->>'reason'),'') is null then raise exception 'Review type and reason are required'; end if;
    select * into v_vendor from core.vendors where id=(payload->>'vendor_id')::uuid for update;
    if not found then raise exception 'Vendor not found'; end if;
    if payload->>'review_type'='reinstatement' and v_vendor.accreditation_status not in ('suspended','offboarded') then
      raise exception 'Only suspended or offboarded vendors can enter reinstatement';
    end if;
    insert into legal.vendor_lifecycle_reviews(vendor_id,review_type,status,due_date,risk_rating,score,reason,evidence_url,opened_by)
    values(v_vendor.id,payload->>'review_type','open',nullif(payload->>'due_date','')::date,
      nullif(payload->>'risk_rating',''),nullif(payload->>'score','')::numeric,pg_catalog.btrim(payload->>'reason'),
      nullif(pg_catalog.btrim(payload->>'evidence_url'),''),v_actor) returning * into v_review;
  else
    select * into v_review from legal.vendor_lifecycle_reviews where id=(payload->>'id')::uuid for update;
    if not found then raise exception 'Vendor lifecycle review not found'; end if;
    if v_action='start' then
      if v_review.status<>'open' then raise exception 'Only an open review can be started'; end if;
      v_review.status:='under_review';
    elsif v_action in ('approve','reject') then
      if v_review.status<>'under_review' then raise exception 'Start the review before a decision'; end if;
      if not core.has_live_cap('legal','approve_accreditation') then raise exception 'Legal decision authority is required'; end if;
      if nullif(pg_catalog.btrim(payload->>'decision_note'),'') is null then raise exception 'A decision note is required'; end if;
      if v_review.review_type in ('suspension','offboarding','reinstatement') and v_review.opened_by=auth.uid() then
        raise exception 'A separate Legal actor must decide suspension, offboarding, or reinstatement';
      end if;
      v_review.status:=case v_action when 'approve' then 'approved' else 'rejected' end;
    elsif v_action='complete' then
      if v_review.status<>'approved' then raise exception 'Only an approved review can be completed'; end if;
      if not core.has_live_cap('legal','approve_accreditation') then raise exception 'Legal decision authority is required'; end if;
      if v_review.review_type in ('suspension','offboarding','reinstatement') and v_review.opened_by is not distinct from auth.uid() then
        raise exception 'A separate Legal actor must complete suspension, offboarding, or reinstatement';
      end if;
      v_review.status:='completed';
    elsif v_action='cancel' then
      if v_review.status not in ('open','under_review') then raise exception 'A decided review cannot be cancelled'; end if;
      if not core.has_live_cap('legal','approve_accreditation') then raise exception 'Legal decision authority is required'; end if;
      v_review.status:='cancelled';
    else raise exception 'Unsupported vendor lifecycle action'; end if;
    update legal.vendor_lifecycle_reviews set status=v_review.status,
      decision_note=coalesce(nullif(pg_catalog.btrim(payload->>'decision_note'),''),decision_note),
      decided_by=case when v_review.status in ('approved','rejected','completed','cancelled') then v_actor else decided_by end,
      decided_at=case when v_review.status in ('approved','rejected','completed','cancelled') then now() else decided_at end
    where id=v_review.id returning * into v_review;
    if v_review.status='completed' then
      if v_review.review_type='suspension' then
        update core.vendors set accreditation_status='suspended' where id=v_review.vendor_id;
      elsif v_review.review_type='offboarding' then
        update core.vendors set accreditation_status='offboarded' where id=v_review.vendor_id;
        update core.profiles set status='disabled' where vendor_id=v_review.vendor_id and kind='vendor';
      elsif v_review.review_type in ('renewal','reinstatement') then
        update core.vendors set accreditation_status='approved',
          accreditation_expires_at=coalesce(nullif(payload->>'expires_at','')::date,accreditation_expires_at)
        where id=v_review.vendor_id;
        update core.profiles set status='active' where vendor_id=v_review.vendor_id and kind='vendor';
        update legal.accreditation_cases set status='approved',
          expires_at=coalesce(nullif(payload->>'expires_at','')::date,expires_at),updated_at=now()
        where id=(select c.id from legal.accreditation_cases c where c.vendor_id=v_review.vendor_id order by c.created_at desc limit 1)
          and status in ('renewal_due','expired','approved','provisional');
      end if;
    end if;
  end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('legal','vendor_lifecycle_review',v_review.id,v_action,v_actor,jsonb_build_object(
    'vendor_id',v_review.vendor_id,'review_type',v_review.review_type,'status',v_review.status));
  return to_jsonb(v_review);
end; $$;

revoke all on function legal.prepare_document_signed_access(jsonb), legal.request_vendor_application_correction(jsonb), legal.save_vendor_application_draft(jsonb), legal.discard_vendor_application_draft(jsonb), legal.submit_vendor_application(jsonb), legal.manage_vendor_lifecycle_review(jsonb) from public, anon;
grant execute on function legal.prepare_document_signed_access(jsonb), legal.request_vendor_application_correction(jsonb), legal.save_vendor_application_draft(jsonb), legal.discard_vendor_application_draft(jsonb), legal.submit_vendor_application(jsonb), legal.manage_vendor_lifecycle_review(jsonb) to authenticated, service_role;
revoke all on function private.save_vendor_application_draft(jsonb), private.discard_vendor_application_draft(jsonb), private.policy_submit_vendor_application(jsonb) from public, anon, authenticated;
grant execute on function private.save_vendor_application_draft(jsonb), private.discard_vendor_application_draft(jsonb), private.policy_submit_vendor_application(jsonb) to service_role;
revoke all on legal.document_access_audit from public, anon, authenticated;
grant select on legal.document_access_audit to authenticated;

drop view if exists core.v_insights_snapshot;
alter function core.insights_snapshot() rename to insights_snapshot_pre_task1;
create or replace function core.insights_snapshot()
returns table(
  id text,area text,label text,value numeric,unit text,target_direction text,
  target_min numeric,target_max numeric,data_status text,sample_count bigint,
  detail text,source_href text,reporting_period_start timestamptz,
  reporting_period_end timestamptz,source_updated_at timestamptz,extracted_at timestamptz
)
language sql security definer stable set search_path='' as $$
  select prior.* from core.insights_snapshot_pre_task1() prior where prior.id<>'pr-cycle'
  union all
  select
    'pr-cycle'::text,
    'procurement'::text,
    'Average PR-to-PO cycle'::text,
    case when count(*)=0 then null else
      round(avg(extract(epoch from (first_po.first_issued_at-r.submitted_at))/86400)::numeric,1)
    end,
    ' days'::text,
    'maximum'::text,
    null::numeric,
    5::numeric,
    case when count(*)=0 then 'no_data' else 'current' end::text,
    count(*)::bigint,
    'Elapsed time from approved PR submission to its first issued PO'::text,
    '/procurement/purchase-orders'::text,
    current_timestamp-interval '90 days',
    current_timestamp,
    max(greatest(r.updated_at,first_po.source_updated_at)),
    current_timestamp
  from procurement.requests r
  join lateral (
    select min(po.issued_at) as first_issued_at,max(po.updated_at) as source_updated_at
    from procurement.purchase_orders po
    where po.request_id=r.id and po.issued_at is not null
  ) first_po on first_po.first_issued_at is not null
  where r.status='approved' and r.submitted_at is not null
    and r.submitted_at>=current_timestamp-interval '90 days'
  having core.has_cap('insights','view_procurement');
$$;
revoke all on function core.insights_snapshot_pre_task1() from public,anon,authenticated;
revoke all on function core.insights_snapshot() from public,anon;
grant execute on function core.insights_snapshot() to authenticated,service_role;
create view core.v_insights_snapshot with (security_invoker=true) as select * from core.insights_snapshot();
grant select on core.v_insights_snapshot to authenticated,service_role;

-- Keep My Work principal-bound and self-describing so the client can reject a
-- stale response after an identity/capability refresh and can fail closed when
-- a source record or required capability is no longer valid.
drop view if exists core.v_my_work;
drop function if exists core.my_work();
create function core.my_work()
returns table(
  id text, principal_id uuid, source text, title text, description text,
  status text, priority text, due_at timestamptz, href text,
  required_module text, required_capability text, source_record_exists boolean
)
language sql security definer stable set search_path='' as $$
  select 'receipt:' || r.id, auth.uid(), 'warehouse', 'Inspect receipt ' || r.id,
    'Receipt evidence and line disposition require quality review.',
    r.quality_status, 'high', r.created_at + interval '1 day',
    '/warehouse/quality', 'warehouse', 'inspect_quality', true
  from warehouse.receipts r
  where core.has_live_cap('warehouse','inspect_quality')
    and r.quality_status in ('pending','partial')
  union all
  select 'count:' || c.id, auth.uid(), 'warehouse', 'Review cycle count ' || c.id,
    'A submitted stock count requires variance review.', c.status,
    'high', coalesce(c.submitted_at,c.created_at) + interval '1 day',
    '/warehouse/cycle-counts', 'warehouse', 'approve_stock_adjustment', true
  from warehouse.cycle_counts c
  where core.has_live_cap('warehouse','approve_stock_adjustment')
    and c.status in ('submitted','pending_approval')
  union all
  select 'request:' || r.id::text, auth.uid(), 'procurement',
    'Review purchase request ' || r.id::text, r.title, r.status, 'normal',
    r.updated_at + interval '2 days', '/procurement/approvals',
    'procurement', 'approve_request', true
  from procurement.requests r
  where core.has_live_cap('procurement','approve_request')
    and r.status in ('submitted','under_review')
  union all
  select 'legal:' || c.id::text, auth.uid(), 'legal',
    'Review vendor accreditation',
    'The submitted vendor case needs a legal determination.', c.status,
    'normal', coalesce(c.submitted_at,c.created_at) + interval '3 days',
    '/legal/accreditation', 'legal', 'review_accreditation', true
  from legal.accreditation_cases c
  where core.has_live_cap('legal','review_accreditation')
    and c.status in ('submitted','under_review')
  union all
  select 'payment:' || p.id::text, auth.uid(), 'finance',
    'Review payment readiness pack',
    'A reconciled acceptance and invoice pack is ready for Finance.', p.status,
    'high', p.prepared_at + interval '2 days',
    '/procurement/purchase-orders/' || p.purchase_order_id,
    'procurement', 'view_finance', true
  from procurement.payment_readiness_packs p
  where core.has_cap('procurement','view_finance')
    and p.status='ready_for_finance'
  union all
  select 'event:' || e.id, auth.uid(), 'events',
    'Confirm event fulfillment: ' || e.name,
    'Review reservations, issue readiness, and the return plan.', 'planned',
    'normal', e.start_date::timestamptz - interval '1 day',
    '/events/' || e.id, 'events', 'view_events', true
  from warehouse.events e
  where core.has_cap('events','view_events')
    and e.start_date between current_date and current_date + 30;
$$;
revoke all on function core.my_work() from public,anon;
grant execute on function core.my_work() to authenticated,service_role;
create view core.v_my_work with (security_invoker=true) as
select * from core.my_work();
grant select on core.v_my_work to authenticated,service_role;

select pg_notify('pgrst', 'reload schema');
