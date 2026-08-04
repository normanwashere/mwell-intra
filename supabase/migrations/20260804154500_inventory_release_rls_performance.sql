-- Evaluate requester identity once per statement instead of once per row.
drop policy if exists fulfillment_reservations_read
  on warehouse.fulfillment_reservations;
create policy fulfillment_reservations_read
  on warehouse.fulfillment_reservations
  for select
  to authenticated
  using (
    core.has_cap('warehouse', 'view_inventory')
    or exists (
      select 1
      from warehouse.fulfillment_orders fulfillment
      where fulfillment.id = order_id
        and fulfillment.created_by = (select auth.uid())
    )
  );
