-- Cover foreign-key access paths introduced by the inventory release lifecycle.
create index if not exists department_cost_centers_created_by_idx
  on core.department_cost_centers(created_by);
create index if not exists department_cost_centers_updated_by_idx
  on core.department_cost_centers(updated_by);

create index if not exists fulfillment_orders_picked_by_idx
  on warehouse.fulfillment_orders(picked_by);

create index if not exists fulfillment_reservations_bin_idx
  on warehouse.fulfillment_reservations(bin_id);
create index if not exists fulfillment_reservations_created_by_idx
  on warehouse.fulfillment_reservations(created_by);
create index if not exists fulfillment_reservations_location_idx
  on warehouse.fulfillment_reservations(location_id);
