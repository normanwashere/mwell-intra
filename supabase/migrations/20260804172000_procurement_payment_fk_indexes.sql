-- Cover new procurement-to-payment foreign keys identified by the database advisor.
create index if not exists sourcing_events_selected_vendor_idx
  on procurement.sourcing_events(selected_vendor_id);
create index if not exists payment_releases_purchase_order_idx
  on procurement.payment_releases(purchase_order_id);
create index if not exists payment_releases_recorded_by_idx
  on procurement.payment_releases(recorded_by);
