import { availableAfterControls } from './warehouseControls';

export interface WarehouseMetricDefinition {
  id: string;
  label: string;
  formula: string;
  numerator: string;
  denominator: string;
  timeBasis: string;
  inclusions: string[];
  exclusions: string[];
  owner: string;
  sourceFields: string[];
  limitation?: string;
}

export function inventoryPosition(input: {
  onHand: number;
  allocations: ReadonlyArray<{ quantity: number; status: string }>;
  holds: ReadonlyArray<{ quantity: number; status: string }>;
  unavailable: number;
}) {
  const committed = input.allocations
    .filter((row) => row.status === 'reserved' || row.status === 'allocated')
    .reduce((sum, row) => sum + row.quantity, 0);
  const held = input.holds
    .filter((row) => row.status === 'active')
    .reduce((sum, row) => sum + row.quantity, 0);
  return {
    onHand: input.onHand,
    committed,
    held,
    unavailable: input.unavailable,
    available: availableAfterControls({ onHand: input.onHand, committed, held, unavailable: input.unavailable }),
  };
}

export const warehouseMetrics: WarehouseMetricDefinition[] = [
  {
    id: 'available_inventory', label: 'Available inventory',
    formula: 'greatest(on_hand - committed - held - unavailable, 0)',
    numerator: 'On-hand less governed deductions', denominator: 'Not applicable',
    timeBasis: 'Current state',
    inclusions: ['In-stock serialized units', 'Bulk stock levels', 'Reserved and allocated commitments', 'Active holds'],
    exclusions: ['Cancelled allocations', 'Released holds', 'Lost and vendor-return units'],
    owner: 'Warehouse Operations',
    sourceFields: ['inventory_position_v1.on_hand', 'inventory_position_v1.committed', 'inventory_position_v1.held', 'inventory_position_v1.unavailable'],
  },
  {
    id: 'return_rate', label: 'Return rate', formula: 'returned quantity / issued quantity * 100',
    numerator: 'Return movements', denominator: 'Issue movements', timeBasis: 'Selected reporting window',
    inclusions: ['Posted return and issue movements'], exclusions: ['Cancelled allocations', 'Draft operations'],
    owner: 'Warehouse BI', sourceFields: ['bi_movements_v1.type', 'bi_movements_v1.quantity', 'bi_movements_v1.created_at'],
    limitation: 'A return outside the selected issue window can shift the rate.',
  },
  {
    id: 'inventory_value', label: 'Inventory value', formula: 'sum(on_hand * unit_cost)',
    numerator: 'Extended on-hand cost', denominator: 'Not applicable', timeBasis: 'Current state',
    inclusions: ['Current on-hand by position'], exclusions: ['Issued, lost, and vendor-return units'],
    owner: 'Finance', sourceFields: ['inventory_position_v1.on_hand', 'products.unit_cost'],
  },
  {
    id: 'count_accuracy', label: 'Cycle-count accuracy', formula: 'exact-match count lines / submitted count lines * 100',
    numerator: 'Lines where expected equals counted', denominator: 'Submitted count lines', timeBasis: 'Selected reporting window',
    inclusions: ['Submitted and decided cycle counts'], exclusions: ['Draft counts'], owner: 'Warehouse Control',
    sourceFields: ['bi_cycle_counts_v1.expected', 'bi_cycle_counts_v1.counted', 'bi_cycle_counts_v1.submitted_at'],
  },
];
