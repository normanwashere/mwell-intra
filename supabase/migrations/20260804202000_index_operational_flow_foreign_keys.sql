-- Cover operational-control foreign keys used by queues, history, and cleanup.

create index if not exists finance_close_entries_prepared_by_idx
  on core.finance_close_entries(prepared_by);
create index if not exists finance_close_entries_posted_by_idx
  on core.finance_close_entries(posted_by);

create index if not exists vendor_lifecycle_reviews_vendor_idx
  on legal.vendor_lifecycle_reviews(vendor_id);
create index if not exists vendor_lifecycle_reviews_opened_by_idx
  on legal.vendor_lifecycle_reviews(opened_by);
create index if not exists vendor_lifecycle_reviews_decided_by_idx
  on legal.vendor_lifecycle_reviews(decided_by);

create index if not exists replenishment_recommendations_request_idx
  on procurement.replenishment_recommendations(procurement_request_id);
create index if not exists replenishment_recommendations_po_idx
  on procurement.replenishment_recommendations(purchase_order_id);
create index if not exists replenishment_recommendations_decided_by_idx
  on procurement.replenishment_recommendations(decided_by);

create index if not exists customer_return_cases_customer_closed_by_idx
  on warehouse.customer_return_cases(customer_closed_by);

create index if not exists event_reconciliations_prepared_by_idx
  on warehouse.event_reconciliations(prepared_by);
create index if not exists event_reconciliations_approved_by_idx
  on warehouse.event_reconciliations(approved_by);

create index if not exists inventory_integrity_cases_product_idx
  on warehouse.inventory_integrity_cases(product_id);
create index if not exists inventory_integrity_cases_lot_idx
  on warehouse.inventory_integrity_cases(lot_id);
create index if not exists inventory_integrity_cases_opened_by_idx
  on warehouse.inventory_integrity_cases(opened_by);
create index if not exists inventory_integrity_cases_resolved_by_idx
  on warehouse.inventory_integrity_cases(resolved_by);