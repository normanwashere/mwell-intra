export const DATASET_IDS = Object.freeze([
  'warehouse.products', 'warehouse.locations', 'warehouse.bins', 'warehouse.lots',
  'warehouse.inventory_units', 'warehouse.inventory_positions', 'warehouse.movements',
  'warehouse.receipts', 'warehouse.inspections', 'warehouse.holds', 'warehouse.allocations',
  'warehouse.department_requests', 'warehouse.fulfillment_orders', 'warehouse.shipment_events',
  'warehouse.return_cases', 'warehouse.vendor_returns', 'warehouse.cycle_counts',
  'warehouse.kit_definitions', 'warehouse.rekit_work_orders', 'procurement.suppliers',
  'procurement.requests', 'procurement.approvals', 'procurement.sourcing_events',
  'procurement.quotations', 'procurement.purchase_orders', 'procurement.purchase_order_lines',
  'procurement.amendments', 'procurement.receipts', 'procurement.payment_readiness', 'reference.links',
] as const);
export type DatasetId = typeof DATASET_IDS[number];
const ids: ReadonlySet<string> = new Set(DATASET_IDS);

export function getDataset(id: string) {
  if (!ids.has(id)) return undefined;
  return Object.freeze({ id: id as DatasetId, availability: 'unavailable' as const, reason: 'mapping_not_verified' as const });
}
