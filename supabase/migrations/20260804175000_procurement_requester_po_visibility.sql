-- Let requesters complete acceptance from their own linked purchase orders
-- without exposing other departments' sourcing or payment records.

drop policy if exists procurement_purchase_orders_read on procurement.purchase_orders;
create policy procurement_purchase_orders_read
  on procurement.purchase_orders for select to authenticated
  using (
    core.has_cap('procurement', 'author_po')
    or core.has_cap('procurement', 'approve_award')
    or core.has_cap('procurement', 'view_finance')
    or core.has_cap('procurement', 'admin')
    or (
      core.has_cap('warehouse', 'receive_stock')
      and status in ('approved', 'issued')
    )
    or exists (
      select 1
      from procurement.requests request
      where request.id = purchase_orders.request_id
        and request.requester_id = (select auth.uid())
    )
  );

drop policy if exists procurement_purchase_order_lines_read on procurement.purchase_order_lines;
create policy procurement_purchase_order_lines_read
  on procurement.purchase_order_lines for select to authenticated
  using (
    exists (
      select 1
      from procurement.purchase_orders po
      where po.id = purchase_order_lines.purchase_order_id
    )
  );

drop policy if exists procurement_sourcing_events_read on procurement.sourcing_events;
create policy procurement_sourcing_events_read
  on procurement.sourcing_events for select to authenticated
  using (
    core.has_cap('procurement', 'manage_rfp')
    or core.has_cap('procurement', 'author_po')
    or core.has_cap('procurement', 'approve_award')
    or core.has_cap('procurement', 'admin')
    or exists (
      select 1 from procurement.requests request
      where request.id = sourcing_events.request_id
        and request.requester_id = (select auth.uid())
    )
  );

drop policy if exists procurement_sourcing_responses_read on procurement.sourcing_responses;
create policy procurement_sourcing_responses_read
  on procurement.sourcing_responses for select to authenticated
  using (
    exists (
      select 1 from procurement.sourcing_events event
      where event.id = sourcing_responses.sourcing_event_id
    )
  );

drop policy if exists procurement_acceptance_read on procurement.acceptance_packs;
create policy procurement_acceptance_read
  on procurement.acceptance_packs for select to authenticated
  using (
    core.has_cap('procurement', 'author_po')
    or core.has_cap('procurement', 'approve_award')
    or core.has_cap('procurement', 'view_finance')
    or core.has_cap('procurement', 'admin')
    or core.has_module_role('warehouse')
    or exists (
      select 1 from procurement.requests request
      where request.id = acceptance_packs.request_id
        and request.requester_id = (select auth.uid())
    )
  );

drop policy if exists procurement_payment_readiness_read on procurement.payment_readiness_packs;
create policy procurement_payment_readiness_read
  on procurement.payment_readiness_packs for select to authenticated
  using (
    core.has_cap('procurement', 'author_po')
    or core.has_cap('procurement', 'view_finance')
    or core.has_cap('procurement', 'admin')
    or exists (
      select 1 from procurement.purchase_orders po
      join procurement.requests request on request.id = po.request_id
      where po.id = payment_readiness_packs.purchase_order_id
        and request.requester_id = (select auth.uid())
    )
  );

select pg_notify('pgrst', 'reload schema');
