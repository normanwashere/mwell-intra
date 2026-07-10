// Core domain entity types for the Mwell Intra warehouse data layer.
//
// Ported verbatim from `mwell-intra-warehouse/src/domain/types.ts` (Step 1d).
// This file is the SELF-CONTAINED source of truth for entity types inside
// `@intra/data-kit`; the warehouse module re-exports from here rather than
// keeping its own copy (spec §12 step 2 — runtime-agnostic data layer).

export type Id = string;

export type ItemCategory = 'device' | 'merchandise';

export type DeviceType = 'smart_watch' | 'sleep_ring' | 'ecg_ring' | 'otg_bag';

export type MerchandiseType =
  | 'shirt'
  | 'jacket'
  | 'token'
  | 'kit'
  | 'other';

export type EventType =
  | 'corporate'
  | 'government_lgu'
  | 'medical_mission'
  | 'vip_activation'
  | 'b2c'
  | 'b2b';

/** Master record for a stock-keeping unit. */
export interface Product {
  id: Id;
  sku: string;
  name: string;
  category: ItemCategory;
  /** Present when category === 'device'. */
  deviceType?: DeviceType;
  /** Present when category === 'merchandise'. */
  merchandiseType?: MerchandiseType;
  /** Whether each physical unit carries a unique serial number. */
  serialized: boolean;
  /** Variant attributes such as size, color, ring size, etc. */
  attributes: Record<string, string>;
  /** Landed cost per unit, used for valuation & pricing. */
  unitCost: number;
  /** Sell price per unit, set by the Pricing role. */
  price?: number;
  /** Trigger replenishment when available stock drops to/below this. */
  reorderPoint: number;
  /** Flag for items used as promotional / corporate give-aways. */
  promotional?: boolean;
  barcode?: string;
  /** Whether receipts may carry an expiry date for this SKU. */
  expiryTracked?: boolean;
  /** Days before expiry when the UI starts warning. */
  shelfLifeWarningDays?: number;
}

export type LocationType = 'warehouse' | 'event_site' | 'vendor';

export interface Location {
  id: Id;
  name: string;
  type: LocationType;
}

/**
 * A scannable storage area (bin / shelf / rack / zone) inside a warehouse.
 * Stock and serialized units carry an optional `binId`; a null bin means the
 * item sits in the warehouse's general/unassigned area.
 */
export interface StorageArea {
  id: Id;
  /** Parent warehouse (a Location of type 'warehouse'). */
  locationId: Id;
  /** Short scannable code printed on the shelf label, e.g. PASIG-A-12. */
  code: string;
  /** Human label, e.g. "Aisle A, Rack 12". */
  label?: string;
  /** Optional grouping, e.g. "Devices", "Apparel", "Cold storage". */
  zone?: string;
  active?: boolean;
}

export interface Supplier {
  id: Id;
  name: string;
  leadTimeDays: number;
}

export interface Lot {
  id: Id;
  productId: Id;
  lotCode: string;
  supplierId?: Id;
  unitCost: number;
  receivedAt: string;
  expiryDate?: string;
}

export type UnitStatus =
  | 'in_stock'
  | 'allocated'
  | 'issued'
  | 'returned'
  | 'vendor_return'
  | 'lost';

/** A single serialized physical unit (e.g. one ECG ring). */
export interface InventoryUnit {
  id: Id;
  productId: Id;
  serialNumber: string;
  lotId?: Id;
  locationId: Id;
  /** Storage area within the location; undefined = general/unassigned area. */
  binId?: Id;
  status: UnitStatus;
  /** Person / event this unit is currently issued to. */
  assignedTo?: string;
  eventId?: Id;
}

/** Aggregate quantity for non-serialized items at a location (+ bin + lot). */
export interface StockLevel {
  productId: Id;
  locationId: Id;
  /** Storage area within the location; undefined = general/unassigned area. */
  binId?: Id;
  lotId?: Id;
  quantity: number;
}

export type MovementType =
  | 'receipt'
  | 'allocation'
  | 'issue'
  | 'return'
  | 'vendor_return'
  | 'transfer'
  | 'adjustment'
  | 'cycle_count';

/** Immutable ledger entry — the audit trail backbone. */
export interface Movement {
  id: Id;
  type: MovementType;
  productId: Id;
  quantity: number;
  fromLocationId?: Id;
  toLocationId?: Id;
  /** Storage areas for putaway / relocation audit. */
  fromBinId?: Id;
  toBinId?: Id;
  lotId?: Id;
  serialNumber?: string;
  eventId?: Id;
  reason?: string;
  reference?: string;
  evidenceUrls?: string[];
  actor: string;
  createdAt: string;
}

export type ReturnSource = 'customer' | 'vendor';

export type ReturnDisposition = 'restock' | 'lost' | 'vendor_return';

export interface ReturnLine {
  productId: Id;
  quantity: number;
  reason: string;
  serialNumber?: string;
  /** Location the stock is returned into (for non-serialized restock). */
  locationId?: Id;
  /** What happens to returned stock: back to shelf, written off, or sent to vendor. */
  disposition?: ReturnDisposition;
}

export interface ReturnRecord {
  id: Id;
  source: ReturnSource;
  eventId?: Id;
  lines: ReturnLine[];
  evidenceUrls?: string[];
  actor: string;
  createdAt: string;
}

export type AllocationStatus =
  | 'reserved'
  | 'allocated'
  | 'issued'
  | 'returned'
  | 'cancelled';

export interface Allocation {
  id: Id;
  eventId: Id;
  productId: Id;
  quantity: number;
  status: AllocationStatus;
  /** Whether the allocation is a promotional give-away vs sold/used. */
  promotional?: boolean;
  createdAt: string;
}

export interface WarehouseEvent {
  id: Id;
  name: string;
  type: EventType;
  siteLocationId?: Id;
  startDate: string;
  endDate?: string;
}

export interface ReceiptLine {
  productId: Id;
  quantity: number;
  lotCode?: string;
  serialNumbers?: string[];
  unitCost?: number;
  /** Storage area the received stock was put away into. */
  binId?: Id;
}

export interface Receipt {
  id: Id;
  supplierId?: Id;
  locationId: Id;
  lines: ReceiptLine[];
  evidenceUrls?: string[];
  actor: string;
  createdAt: string;
}

export interface CycleCountLine {
  productId: Id;
  expected: number;
  counted: number;
}

export interface CycleCount {
  id: Id;
  locationId: Id;
  /** Storage area that was counted (undefined = general/location-wide count). */
  binId?: Id;
  category?: ItemCategory;
  lines: CycleCountLine[];
  actor: string;
  createdAt: string;
}

export type POStatus =
  | 'draft'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface PurchaseOrderLine {
  productId: Id;
  quantityOrdered: number;
  quantityReceived: number;
}

/** A supplier purchase order with one line per product. */
export interface PurchaseOrder {
  id: Id;
  supplierId: Id;
  status: POStatus;
  lines: PurchaseOrderLine[];
  expectedDate?: string;
  actor: string;
  createdAt: string;
}

/** Warehouse roles exposed by the module. */
export type Role =
  | 'logistics_supervisor'
  | 'operations'
  | 'finance'
  | 'bi_analyst'
  | 'business_unit'
  | 'marketing'
  | 'procurement'
  | 'pricing'
  | 'warehouse_admin';

/** A demo/staff user that signs in by picking their role. */
export interface Profile {
  id: Id;
  role: Role;
  name: string;
  email: string;
  title: string;
}
