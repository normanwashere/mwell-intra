import type {
  Allocation,
  CycleCount,
  InventoryUnit,
  Location,
  Lot,
  Movement,
  Product,
  Profile,
  PurchaseOrder,
  Receipt,
  ReturnRecord,
  StockLevel,
  StorageArea,
  Supplier,
  WarehouseEvent,
} from './domain/types';
import type { WarehouseData } from './repository';

const now = '2026-06-01T08:00:00.000Z';

/** Demo staff accounts — one per role. Used by the role-tile login screen. */
const profiles: Profile[] = [
  { id: 'usr-logistics', role: 'logistics_supervisor', name: 'Marco Reyes', email: 'marco.reyes@mwell.com.ph', title: 'Warehouse Supervisor' },
  { id: 'usr-operations', role: 'operations', name: 'Joana Cruz', email: 'joana.cruz@mwell.com.ph', title: 'eCommerce Operations Manager' },
  { id: 'usr-finance', role: 'finance', name: 'Liza Tan', email: 'liza.tan@mwell.com.ph', title: 'Finance Manager' },
  { id: 'usr-bi', role: 'bi_analyst', name: 'Kevin Uy', email: 'kevin.uy@mwell.com.ph', title: 'BI Analyst' },
  { id: 'usr-bu', role: 'business_unit', name: 'Patricia Lim', email: 'patricia.lim@mwell.com.ph', title: 'Business Unit Head' },
  { id: 'usr-marketing', role: 'marketing', name: 'Miguel Santos', email: 'miguel.santos@mwell.com.ph', title: 'Marketing Lead' },
  { id: 'usr-procurement', role: 'procurement', name: 'Grace Velasco', email: 'grace.velasco@mwell.com.ph', title: 'Procurement Officer' },
  { id: 'usr-pricing', role: 'pricing', name: 'Daniel Co', email: 'daniel.co@mwell.com.ph', title: 'Pricing Analyst' },
];

const locations: Location[] = [
  { id: 'loc-wh', name: 'Pasig Main Warehouse', type: 'warehouse' },
  { id: 'loc-cebu', name: 'Cebu Hub', type: 'warehouse' },
  { id: 'loc-event-makati', name: 'Makati Corporate Activation', type: 'event_site' },
  { id: 'loc-event-lgu', name: 'LGU Medical Mission Site', type: 'event_site' },
  { id: 'loc-vendor', name: 'Vendor Returns', type: 'vendor' },
];

// Scannable storage areas (bins/shelves) inside the Pasig warehouse. Seed stock
// stays in the general area (binId undefined); staff put away into these bins.
const storageAreas: StorageArea[] = [
  { id: 'bin-pasig-a1', locationId: 'loc-wh', code: 'PASIG-A-01', label: 'Aisle A · Rack 01', zone: 'Devices', active: true },
  { id: 'bin-pasig-a2', locationId: 'loc-wh', code: 'PASIG-A-02', label: 'Aisle A · Rack 02', zone: 'Devices', active: true },
  { id: 'bin-pasig-b1', locationId: 'loc-wh', code: 'PASIG-B-01', label: 'Aisle B · Rack 01', zone: 'Apparel', active: true },
  { id: 'bin-pasig-c1', locationId: 'loc-wh', code: 'PASIG-C-01', label: 'Aisle C · Bin 01', zone: 'Giveaways', active: true },
  { id: 'bin-cebu-a1', locationId: 'loc-cebu', code: 'CEBU-A-01', label: 'Aisle A · Rack 01', active: true },
];

const suppliers: Supplier[] = [
  { id: 'sup-wearables', name: 'mWellness Wearables Mfg.', leadTimeDays: 30 },
  { id: 'sup-apparel', name: 'MetroPrint Apparel', leadTimeDays: 14 },
  { id: 'sup-tokens', name: 'GiftWorks PH', leadTimeDays: 10 },
];

const ringSizes = ['6', '7', '8', '9', '10', '11'];
const apparelSizes = ['S', 'M', 'L', 'XL'];

const products: Product[] = [
  ...ringSizes.map<Product>((size) => ({
    id: `ecg-ring-${size}`,
    sku: `ECG-RING-${size}`,
    name: `ECG Ring (Size ${size})`,
    category: 'device',
    deviceType: 'ecg_ring',
    serialized: true,
    attributes: { ringSize: size },
    unitCost: 2500,
    price: 3375,
    reorderPoint: 6,
    barcode: `48000${size.padStart(2, '0')}01`,
  })),
  ...ringSizes.map<Product>((size) => ({
    id: `sleep-ring-${size}`,
    sku: `SLEEP-RING-${size}`,
    name: `Sleep Ring (Size ${size})`,
    category: 'device',
    deviceType: 'sleep_ring',
    serialized: true,
    attributes: { ringSize: size },
    unitCost: 1800,
    price: 2430,
    reorderPoint: 6,
    barcode: `48000${size.padStart(2, '0')}02`,
  })),
  {
    id: 'smart-watch',
    sku: 'SMART-WATCH',
    name: 'mWellness Smart Watch',
    category: 'device',
    deviceType: 'smart_watch',
    serialized: true,
    attributes: {},
    unitCost: 3200,
    price: 4320,
    reorderPoint: 10,
    barcode: '4800099903',
  },
  {
    id: 'otg-bag',
    sku: 'OTG-BAG',
    name: 'On-The-Go Bag',
    category: 'device',
    deviceType: 'otg_bag',
    serialized: true,
    attributes: {},
    unitCost: 8500,
    price: 11475,
    reorderPoint: 4,
    barcode: '4800099904',
  },
  ...apparelSizes.map<Product>((size) => ({
    id: `shirt-${size.toLowerCase()}`,
    sku: `SHIRT-${size}`,
    name: `Event Shirt (${size})`,
    category: 'merchandise',
    merchandiseType: 'shirt',
    serialized: false,
    attributes: { size },
    unitCost: 220,
    price: 350,
    reorderPoint: 50,
    promotional: true,
    barcode: `49000${size}01`,
  })),
  ...apparelSizes.map<Product>((size) => ({
    id: `jacket-${size.toLowerCase()}`,
    sku: `JACKET-${size}`,
    name: `Event Jacket (${size})`,
    category: 'merchandise',
    merchandiseType: 'jacket',
    serialized: false,
    attributes: { size },
    unitCost: 650,
    price: 975,
    reorderPoint: 20,
    promotional: true,
    barcode: `49000${size}02`,
  })),
  {
    id: 'doctor-token',
    sku: 'TOKEN-DOC',
    name: 'Doctor Token',
    category: 'merchandise',
    merchandiseType: 'token',
    serialized: false,
    attributes: {},
    unitCost: 350,
    price: 490,
    reorderPoint: 100,
    promotional: true,
    barcode: '4900099905',
  },
];

const lots: Lot[] = [
  { id: 'lot-ring-a', productId: 'ecg-ring-10', lotCode: 'LOT-ECG-2604', supplierId: 'sup-wearables', unitCost: 2500, receivedAt: now },
  { id: 'lot-watch-a', productId: 'smart-watch', lotCode: 'LOT-WATCH-2605', supplierId: 'sup-wearables', unitCost: 3200, receivedAt: now },
];

// Serialized units for devices. Smaller, demo-friendly counts.
function makeUnits(): InventoryUnit[] {
  const units: InventoryUnit[] = [];
  const devices = products.filter((p) => p.serialized);
  for (const p of devices) {
    // some sizes deliberately low to trigger reorder alerts
    const base = p.deviceType === 'otg_bag' ? 3 : p.id.endsWith('-6') ? 4 : 12;
    for (let i = 0; i < base; i++) {
      const status =
        i < 2 && p.deviceType === 'ecg_ring' ? 'issued' : 'in_stock';
      units.push({
        id: `${p.id}-u${i + 1}`,
        productId: p.id,
        serialNumber: `${p.sku}-SN${(i + 1).toString().padStart(4, '0')}`,
        locationId: 'loc-wh',
        status,
        assignedTo: status === 'issued' ? 'Dr. Activation' : undefined,
        eventId: status === 'issued' ? 'evt-makati' : undefined,
      });
    }
  }
  return units;
}

// Extra serialized stock distributed across sites so traceability and
// transfer views show multiple locations (not just the main warehouse).
const multiSiteUnits: InventoryUnit[] = [
  { id: 'ecg-ring-10-cebu1', productId: 'ecg-ring-10', serialNumber: 'ECG-RING-10-CB0001', locationId: 'loc-cebu', status: 'in_stock' },
  { id: 'ecg-ring-10-cebu2', productId: 'ecg-ring-10', serialNumber: 'ECG-RING-10-CB0002', locationId: 'loc-cebu', status: 'in_stock' },
  { id: 'smart-watch-cebu1', productId: 'smart-watch', serialNumber: 'SMART-WATCH-CB0001', locationId: 'loc-cebu', status: 'in_stock' },
  { id: 'smart-watch-cebu2', productId: 'smart-watch', serialNumber: 'SMART-WATCH-CB0002', locationId: 'loc-cebu', status: 'in_stock' },
  { id: 'smart-watch-makati1', productId: 'smart-watch', serialNumber: 'SMART-WATCH-MK0001', locationId: 'loc-event-makati', status: 'in_stock' },
  { id: 'sleep-ring-8-cebu1', productId: 'sleep-ring-8', serialNumber: 'SLEEP-RING-8-CB0001', locationId: 'loc-cebu', status: 'in_stock' },
];

// Serialized devices currently out in the field (assigned to people/events) so
// the asset register and event costing views have populated data.
const fieldAssignedUnits: InventoryUnit[] = [
  { id: 'ecg-ring-10-fld1', productId: 'ecg-ring-10', serialNumber: 'ECG-RING-10-FLD001', locationId: 'loc-event-makati', status: 'issued', assignedTo: 'Dr. Santos', eventId: 'evt-makati' },
  { id: 'ecg-ring-8-fld1', productId: 'ecg-ring-8', serialNumber: 'ECG-RING-8-FLD001', locationId: 'loc-event-lgu', status: 'issued', assignedTo: 'Dr. Santos', eventId: 'evt-lgu' },
  { id: 'smart-watch-vip1', productId: 'smart-watch', serialNumber: 'SMART-WATCH-VIP001', locationId: 'loc-event-makati', status: 'issued', assignedTo: "VIP - Mayor's Office", eventId: 'evt-vip' },
];

const units = [...makeUnits(), ...multiSiteUnits, ...fieldAssignedUnits];

const stockLevels: StockLevel[] = [
  ...products
    .filter((p) => !p.serialized)
    .map<StockLevel>((p) => ({
      productId: p.id,
      locationId: 'loc-wh',
      quantity:
        p.merchandiseType === 'token' ? 80 : p.attributes.size === 'M' ? 240 : 120,
    })),
  // Cebu hub + active event site stock for non-serialized merchandise.
  { productId: 'shirt-l', locationId: 'loc-cebu', quantity: 60 },
  { productId: 'shirt-m', locationId: 'loc-cebu', quantity: 40 },
  { productId: 'jacket-m', locationId: 'loc-cebu', quantity: 25 },
  { productId: 'doctor-token', locationId: 'loc-cebu', quantity: 50 },
  { productId: 'shirt-l', locationId: 'loc-event-makati', quantity: 30 },
  { productId: 'doctor-token', locationId: 'loc-event-makati', quantity: 20 },
];

const events: WarehouseEvent[] = [
  { id: 'evt-makati', name: 'Makati Corporate Wellness Day', type: 'corporate', siteLocationId: 'loc-event-makati', startDate: '2026-06-10' },
  { id: 'evt-lgu', name: 'Bataan LGU Medical Mission', type: 'medical_mission', siteLocationId: 'loc-event-lgu', startDate: '2026-06-18' },
  { id: 'evt-vip', name: 'VIP Doctor Appreciation', type: 'vip_activation', startDate: '2026-06-25' },
  { id: 'evt-smx', name: 'SM Megamall B2C Activation', type: 'b2c', startDate: '2026-07-02' },
  { id: 'evt-bgc', name: 'BGC Corporate Health Fair', type: 'corporate', startDate: '2026-07-12' },
];

const allocations: Allocation[] = [
  { id: 'alloc-1', eventId: 'evt-makati', productId: 'shirt-l', quantity: 100, status: 'issued', promotional: true, createdAt: now },
  { id: 'alloc-2', eventId: 'evt-makati', productId: 'ecg-ring-10', quantity: 2, status: 'issued', createdAt: now },
  { id: 'alloc-3', eventId: 'evt-lgu', productId: 'doctor-token', quantity: 50, status: 'reserved', promotional: true, createdAt: now },
  { id: 'alloc-4', eventId: 'evt-vip', productId: 'smart-watch', quantity: 8, status: 'reserved', createdAt: now },
];

const movements: Movement[] = [
  { id: 'mv-1', type: 'issue', productId: 'shirt-l', quantity: 100, eventId: 'evt-makati', actor: 'ops@mwell', createdAt: '2026-06-10T09:00:00.000Z' },
  { id: 'mv-2', type: 'issue', productId: 'ecg-ring-10', quantity: 2, eventId: 'evt-makati', actor: 'ops@mwell', createdAt: '2026-06-10T09:05:00.000Z' },
  { id: 'mv-3', type: 'issue', productId: 'smart-watch', quantity: 20, eventId: 'evt-makati', actor: 'ops@mwell', createdAt: '2026-06-10T09:10:00.000Z' },
  { id: 'mv-4', type: 'return', productId: 'smart-watch', quantity: 6, eventId: 'evt-makati', reason: 'unused', actor: 'ops@mwell', createdAt: '2026-06-12T17:00:00.000Z' },
  { id: 'mv-5', type: 'issue', productId: 'doctor-token', quantity: 60, eventId: 'evt-lgu', actor: 'mktg@mwell', createdAt: '2026-06-18T10:00:00.000Z' },
  { id: 'mv-6', type: 'issue', productId: 'shirt-m', quantity: 150, eventId: 'evt-lgu', actor: 'mktg@mwell', createdAt: '2026-06-18T10:30:00.000Z' },
  { id: 'mv-7', type: 'issue', productId: 'ecg-ring-8', quantity: 8, eventId: 'evt-lgu', actor: 'ops@mwell', createdAt: '2026-06-18T11:00:00.000Z' },
  { id: 'mv-8', type: 'return', productId: 'ecg-ring-8', quantity: 1, eventId: 'evt-lgu', reason: 'defective', actor: 'ops@mwell', createdAt: '2026-06-19T09:00:00.000Z' },
  { id: 'mv-9', type: 'receipt', productId: 'shirt-m', quantity: 150, toLocationId: 'loc-wh', reference: 'po-apparel-1', actor: 'marco.reyes@mwell.com.ph', createdAt: '2026-06-08T08:30:00.000Z' },
  { id: 'mv-10', type: 'transfer', productId: 'shirt-l', quantity: 20, fromLocationId: 'loc-wh', toLocationId: 'loc-cebu', actor: 'marco.reyes@mwell.com.ph', createdAt: '2026-06-09T10:00:00.000Z' },
  { id: 'mv-11', type: 'issue', productId: 'jacket-m', quantity: 30, eventId: 'evt-makati', actor: 'ops@mwell', createdAt: '2026-06-10T09:20:00.000Z' },
  { id: 'mv-12', type: 'return', productId: 'jacket-m', quantity: 4, eventId: 'evt-makati', reason: 'wrong size (restock)', actor: 'ops@mwell', createdAt: '2026-06-13T12:00:00.000Z' },
  { id: 'mv-13', type: 'cycle_count', productId: 'doctor-token', quantity: -5, toLocationId: 'loc-wh', reason: 'cycle count adjustment', actor: 'liza.tan@mwell.com.ph', createdAt: '2026-06-14T15:00:00.000Z' },
  { id: 'mv-14', type: 'issue', productId: 'shirt-l', quantity: 40, eventId: 'evt-smx', actor: 'mktg@mwell', createdAt: '2026-07-02T10:00:00.000Z' },
];

const returns: ReturnRecord[] = [
  {
    id: 'ret-1',
    source: 'customer',
    eventId: 'evt-makati',
    lines: [{ productId: 'jacket-m', quantity: 4, reason: 'wrong size', disposition: 'restock' }],
    actor: 'ops@mwell',
    createdAt: '2026-06-13T12:00:00.000Z',
  },
  {
    id: 'ret-2',
    source: 'customer',
    eventId: 'evt-lgu',
    lines: [{ productId: 'doctor-token', quantity: 3, reason: 'surplus / damaged', disposition: 'lost' }],
    actor: 'mktg@mwell',
    createdAt: '2026-06-19T16:00:00.000Z',
  },
];

const cycleCounts: CycleCount[] = [
  {
    id: 'cc-1',
    locationId: 'loc-wh',
    category: 'merchandise',
    lines: [
      { productId: 'doctor-token', expected: 85, counted: 80 },
      { productId: 'shirt-l', expected: 120, counted: 120 },
      { productId: 'jacket-m', expected: 240, counted: 240 },
    ],
    actor: 'liza.tan@mwell.com.ph',
    createdAt: '2026-06-14T15:00:00.000Z',
  },
];

const receipts: Receipt[] = [
  {
    id: 'rcpt-1',
    supplierId: 'sup-apparel',
    locationId: 'loc-wh',
    lines: [{ productId: 'shirt-m', quantity: 150 }],
    actor: 'marco.reyes@mwell.com.ph',
    createdAt: '2026-06-08T08:30:00.000Z',
  },
];

const purchaseOrders: PurchaseOrder[] = [
  {
    id: 'po-wearables-1',
    supplierId: 'sup-wearables',
    status: 'ordered',
    lines: [
      { productId: 'smart-watch', quantityOrdered: 50, quantityReceived: 0 },
      { productId: 'ecg-ring-10', quantityOrdered: 30, quantityReceived: 0 },
    ],
    expectedDate: '2026-07-15',
    actor: 'procurement@mwell',
    createdAt: '2026-06-05T08:00:00.000Z',
  },
  {
    id: 'po-apparel-1',
    supplierId: 'sup-apparel',
    status: 'partially_received',
    lines: [
      { productId: 'shirt-m', quantityOrdered: 300, quantityReceived: 150 },
      { productId: 'jacket-m', quantityOrdered: 100, quantityReceived: 0 },
    ],
    expectedDate: '2026-06-20',
    actor: 'procurement@mwell',
    createdAt: '2026-06-02T08:00:00.000Z',
  },
  {
    id: 'po-tokens-1',
    supplierId: 'sup-tokens',
    status: 'received',
    lines: [
      { productId: 'doctor-token', quantityOrdered: 200, quantityReceived: 200 },
    ],
    expectedDate: '2026-06-10',
    actor: 'procurement@mwell',
    createdAt: '2026-05-28T08:00:00.000Z',
  },
  {
    id: 'po-wearables-2',
    supplierId: 'sup-wearables',
    status: 'draft',
    lines: [
      { productId: 'sleep-ring-6', quantityOrdered: 24, quantityReceived: 0 },
      { productId: 'otg-bag', quantityOrdered: 10, quantityReceived: 0 },
    ],
    expectedDate: '2026-07-20',
    actor: 'grace.velasco@mwell.com.ph',
    createdAt: '2026-06-11T08:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// 90-day activity history (relative to `now`) — richer movement curves for
// sparklines / BI analytics, plus extra cycle counts, returns and receipts.
// Deterministic: a tiny LCG drives the variation so the same `now` always
// produces the same history.
// ---------------------------------------------------------------------------

function lcg(seedValue: number): () => number {
  let s = seedValue >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function isoDaysAgo(now: Date, days: number, hour: number, minute = 0): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function isoDaysAhead(now: Date, days: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ActivityHistory {
  movements: Movement[];
  returns: ReturnRecord[];
  cycleCounts: CycleCount[];
  receipts: Receipt[];
  events: WarehouseEvent[];
  allocations: Allocation[];
}

/**
 * Build ~50 movements over the past 90 days plus supporting records so the
 * dashboards, sparklines and BI panels show real activity curves out of the
 * box. Exported standalone so tests can assert on it directly.
 */
export function buildActivityHistory(now: Date = new Date()): ActivityHistory {
  const rand = lcg(20260706);
  const extraMovements: Movement[] = [];

  const issueTargets = [
    { productId: 'shirt-m', base: 18 },
    { productId: 'shirt-l', base: 14 },
    { productId: 'doctor-token', base: 22 },
    { productId: 'jacket-m', base: 6 },
    { productId: 'ecg-ring-10', base: 3 },
    { productId: 'ecg-ring-8', base: 2 },
    { productId: 'smart-watch', base: 4 },
    { productId: 'sleep-ring-8', base: 2 },
  ];
  const eventCycle = ['evt-makati', 'evt-lgu', 'evt-smx', 'evt-bgc'];
  const actorCycle = ['ops@mwell', 'mktg@mwell', 'marco.reyes@mwell.com.ph'];

  let mvSeq = 100;
  // Issues cluster on weekdays; volume ramps up toward "now" (H2 season).
  for (let day = 89; day >= 0; day -= 2) {
    const target = issueTargets[(day / 2) % issueTargets.length | 0]!;
    const ramp = 1 + (89 - day) / 89; // 1.0 → 2.0
    const qty = Math.max(1, Math.round(target.base * ramp * (0.6 + rand() * 0.8)));
    extraMovements.push({
      id: `mv-h${mvSeq++}`,
      type: 'issue',
      productId: target.productId,
      quantity: qty,
      eventId: eventCycle[day % eventCycle.length]!,
      actor: actorCycle[day % actorCycle.length]!,
      createdAt: isoDaysAgo(now, day, 9 + (day % 6), (day * 7) % 60),
    });
    // Roughly every 12 days an issue is followed by a small return.
    if (day % 12 === 1) {
      extraMovements.push({
        id: `mv-h${mvSeq++}`,
        type: 'return',
        productId: target.productId,
        quantity: Math.max(1, Math.round(qty * 0.15)),
        eventId: eventCycle[day % eventCycle.length]!,
        reason: day % 24 === 1 ? 'defective' : 'unused',
        actor: actorCycle[(day + 1) % actorCycle.length]!,
        createdAt: isoDaysAgo(now, Math.max(0, day - 1), 16),
      });
    }
  }
  // Weekly receipts + a transfer every ~2 weeks.
  const receiptRotation = [
    { productId: 'shirt-m', quantity: 120, supplierId: 'sup-apparel' },
    { productId: 'doctor-token', quantity: 150, supplierId: 'sup-tokens' },
    { productId: 'jacket-l', quantity: 60, supplierId: 'sup-apparel' },
    { productId: 'shirt-xl', quantity: 90, supplierId: 'sup-apparel' },
  ];
  for (let week = 12; week >= 1; week--) {
    const r = receiptRotation[week % receiptRotation.length]!;
    extraMovements.push({
      id: `mv-h${mvSeq++}`,
      type: 'receipt',
      productId: r.productId,
      quantity: r.quantity,
      toLocationId: 'loc-wh',
      reference: `po-hist-${week}`,
      actor: 'marco.reyes@mwell.com.ph',
      createdAt: isoDaysAgo(now, week * 7, 8, 30),
    });
    if (week % 2 === 0) {
      extraMovements.push({
        id: `mv-h${mvSeq++}`,
        type: 'transfer',
        productId: week % 4 === 0 ? 'shirt-l' : 'doctor-token',
        quantity: 15 + (week % 3) * 5,
        fromLocationId: 'loc-wh',
        toLocationId: 'loc-cebu',
        actor: 'marco.reyes@mwell.com.ph',
        createdAt: isoDaysAgo(now, week * 7 - 2, 11),
      });
    }
  }
  // Monthly cycle-count adjustments.
  for (const day of [75, 45, 15]) {
    extraMovements.push({
      id: `mv-h${mvSeq++}`,
      type: 'cycle_count',
      productId: day === 45 ? 'shirt-m' : 'doctor-token',
      quantity: day === 45 ? -8 : day === 75 ? -3 : 2,
      toLocationId: 'loc-wh',
      reason: 'cycle count adjustment',
      actor: 'liza.tan@mwell.com.ph',
      createdAt: isoDaysAgo(now, day, 15),
    });
  }

  const extraReturns: ReturnRecord[] = [
    // Products avoid shirt-l so freshly-recorded shirt-l returns stay
    // unambiguous in the list (mirrors the allocations note above).
    {
      id: 'ret-h1',
      source: 'customer',
      eventId: 'evt-smx',
      lines: [
        { productId: 'shirt-xl', quantity: 6, reason: 'wrong size', disposition: 'restock' },
        { productId: 'shirt-m', quantity: 2, reason: 'print defect', disposition: 'lost' },
      ],
      actor: 'ops@mwell',
      createdAt: isoDaysAgo(now, 6, 14),
    },
    {
      id: 'ret-h2',
      source: 'customer',
      eventId: 'evt-bgc',
      lines: [
        { productId: 'jacket-m', quantity: 5, reason: 'unused surplus', disposition: 'restock' },
        { productId: 'doctor-token', quantity: 10, reason: 'unused surplus', disposition: 'restock' },
      ],
      actor: 'mktg@mwell',
      createdAt: isoDaysAgo(now, 2, 17),
    },
  ];

  const extraCycleCounts: CycleCount[] = [
    {
      id: 'cc-h1',
      locationId: 'loc-wh',
      category: 'merchandise',
      lines: [
        { productId: 'shirt-m', expected: 232, counted: 224 },
        { productId: 'shirt-l', expected: 120, counted: 120 },
        { productId: 'doctor-token', expected: 80, counted: 80 },
      ],
      actor: 'liza.tan@mwell.com.ph',
      createdAt: isoDaysAgo(now, 45, 15),
    },
    {
      id: 'cc-h2',
      locationId: 'loc-cebu',
      category: 'merchandise',
      lines: [
        { productId: 'shirt-l', expected: 60, counted: 60 },
        { productId: 'jacket-m', expected: 25, counted: 25 },
        { productId: 'doctor-token', expected: 50, counted: 52 },
      ],
      actor: 'liza.tan@mwell.com.ph',
      createdAt: isoDaysAgo(now, 15, 15),
    },
  ];

  const extraReceipts: Receipt[] = [
    {
      id: 'rcpt-h1',
      supplierId: 'sup-tokens',
      locationId: 'loc-wh',
      lines: [{ productId: 'doctor-token', quantity: 150 }],
      actor: 'marco.reyes@mwell.com.ph',
      createdAt: isoDaysAgo(now, 21, 8, 30),
    },
    {
      id: 'rcpt-h2',
      supplierId: 'sup-apparel',
      locationId: 'loc-wh',
      lines: [
        { productId: 'shirt-xl', quantity: 90 },
        { productId: 'jacket-l', quantity: 60 },
      ],
      actor: 'marco.reyes@mwell.com.ph',
      createdAt: isoDaysAgo(now, 7, 8, 30),
    },
  ];

  // Upcoming event with reserved allocations so planning views have a future.
  const upcomingEvent: WarehouseEvent = {
    id: 'evt-cebu-mission',
    name: 'Cebu Provincial Health Mission',
    type: 'medical_mission',
    siteLocationId: 'loc-cebu',
    startDate: isoDaysAhead(now, 12),
    endDate: isoDaysAhead(now, 14),
  };
  // Products chosen to avoid duplicating the base seed's reserved rows
  // (doctor-token / shirt-l) — keeps status-filter UIs and tests unambiguous.
  const upcomingAllocations: Allocation[] = [
    { id: 'alloc-h1', eventId: 'evt-cebu-mission', productId: 'shirt-m', quantity: 80, status: 'reserved', promotional: true, createdAt: isoDaysAgo(now, 3, 10) },
    { id: 'alloc-h2', eventId: 'evt-cebu-mission', productId: 'jacket-l', quantity: 40, status: 'reserved', promotional: true, createdAt: isoDaysAgo(now, 3, 10, 15) },
    { id: 'alloc-h3', eventId: 'evt-cebu-mission', productId: 'ecg-ring-9', quantity: 4, status: 'reserved', createdAt: isoDaysAgo(now, 2, 9) },
  ];

  return {
    movements: extraMovements,
    returns: extraReturns,
    cycleCounts: extraCycleCounts,
    receipts: extraReceipts,
    events: [upcomingEvent],
    allocations: upcomingAllocations,
  };
}

export function buildProfiles(): Profile[] {
  return profiles.map((p) => ({ ...p }));
}

export function buildSeed(): WarehouseData {
  const history = buildActivityHistory(new Date());
  return {
    products,
    locations,
    storageAreas,
    suppliers,
    lots,
    units,
    stockLevels,
    movements: [...movements, ...history.movements],
    allocations: [...allocations, ...history.allocations],
    events: [...events, ...history.events],
    returns: [...returns, ...history.returns],
    cycleCounts: [...cycleCounts, ...history.cycleCounts],
    receipts: [...receipts, ...history.receipts],
    purchaseOrders,
  };
}
