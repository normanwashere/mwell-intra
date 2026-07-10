import type {
  Allocation,
  CycleCount,
  DeviceType,
  EventType,
  InventoryUnit,
  ItemCategory,
  Location,
  Lot,
  MerchandiseType,
  Movement,
  Product,
  Profile,
  PurchaseOrder,
  Receipt,
  ReturnDisposition,
  ReturnRecord,
  StockLevel,
  StorageArea,
  Supplier,
  WarehouseEvent,
} from './domain/types';
import type { StockState } from './domain/stock';
import type {
  DecideStockChangeInput,
  CreateVendorReturnInput,
  InspectQualityInput,
  InventoryHold,
  InventoryPosition,
  OperationRoute,
  OperationType,
  PageQuery,
  PageResult,
  ProcurementPOHandoff,
  QualityInspection,
  ReleaseHoldInput,
  ReceiveProcurementPOInput,
  ResolveExceptionInput,
  StockChangeRequest,
  SubmitCycleCountInput,
  UpdateOperationRouteInput,
  WarehouseException,
  WarehouseTask,
  VendorReturn,
} from './domain/warehouseControls';

/** Full snapshot of the warehouse read model. */
export interface WarehouseData {
  products: Product[];
  locations: Location[];
  storageAreas: StorageArea[];
  suppliers: Supplier[];
  lots: Lot[];
  units: InventoryUnit[];
  stockLevels: StockLevel[];
  movements: Movement[];
  allocations: Allocation[];
  events: WarehouseEvent[];
  returns: ReturnRecord[];
  cycleCounts: CycleCount[];
  receipts: Receipt[];
  purchaseOrders: PurchaseOrder[];
  operationTypes?: OperationType[];
  operationRoutes?: OperationRoute[];
}

export interface ReceiveStockInput {
  supplierId?: string;
  locationId: string;
  lines: {
    productId: string;
    quantity: number;
    lotCode?: string;
    expiryDate?: string;
    serialNumbers?: string[];
    unitCost?: number;
    /** Storage area the stock is put away into (undefined = general area). */
    binId?: string;
  }[];
  evidenceUrls?: string[];
  actor: string;
}

export interface ReserveInput {
  eventId: string;
  productId: string;
  quantity: number;
  promotional?: boolean;
  actor: string;
}

export interface IssueInput {
  allocationId: string;
  actor: string;
  assignedTo?: string;
  serialNumbers?: string[];
  evidenceUrls?: string[];
  /** Location to draw stock from. Defaults to the location holding stock. */
  sourceLocationId?: string;
  /** Storage area to draw from (undefined = general area). */
  sourceBinId?: string;
}

export interface ReturnInput {
  source: ReturnRecord['source'];
  eventId?: string;
  /** When set, the matching allocation is closed out (status -> 'returned'). */
  allocationId?: string;
  lines: {
    productId: string;
    quantity: number;
    reason: string;
    serialNumber?: string;
    locationId?: string;
    /** Storage area to restock into (undefined = general area). */
    binId?: string;
    disposition?: ReturnDisposition;
  }[];
  evidenceUrls?: string[];
  actor: string;
}

export interface CycleCountInput {
  locationId: string;
  category?: 'device' | 'merchandise';
  /** Storage area being counted (undefined = general area). */
  binId?: string;
  lines: { productId: string; expected: number; counted: number }[];
  actor: string;
}

export interface TransferInput {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  serialNumbers?: string[];
  /** Source/destination storage areas (undefined = general area). */
  fromBinId?: string;
  toBinId?: string;
  actor: string;
}

/** Move stock between storage areas within a single warehouse. */
export interface RelocateInput {
  productId: string;
  locationId: string;
  fromBinId?: string;
  toBinId?: string;
  quantity: number;
  serialNumbers?: string[];
  actor: string;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  lines: { productId: string; quantityOrdered: number }[];
  expectedDate?: string;
  actor: string;
}

export interface ReceiveAgainstPOInput {
  poId: string;
  lines: { productId: string; quantityReceived: number }[];
  locationId: string;
  /** Storage area to put received stock away into (undefined = general area). */
  binId?: string;
  actor: string;
}

export interface CreateEventInput {
  name: string;
  type: EventType;
  siteLocationId?: string;
  startDate: string;
  endDate?: string;
}

export interface CancelAllocationInput {
  allocationId: string;
  actor: string;
}

export interface CancelPurchaseOrderInput {
  poId: string;
  actor: string;
}

export interface CreateSupplierInput {
  name: string;
  leadTimeDays: number;
}

export interface CreateLocationInput {
  id?: string;
  name: string;
  type: Location['type'];
}

export interface UpdateLocationInput {
  locationId: string;
  name: string;
  type: Location['type'];
}

export interface CreateStorageAreaInput {
  id?: string;
  locationId: string;
  code: string;
  label?: string;
  zone?: string;
}

export interface UpdateStorageAreaInput {
  storageAreaId: string;
  code: string;
  label?: string;
  zone?: string;
  active?: boolean;
}

export interface UpdateSupplierInput {
  supplierId: string;
  name: string;
  leadTimeDays: number;
}

export interface SetProductPriceInput {
  productId: string;
  price: number;
  actor: string;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  category: ItemCategory;
  deviceType?: DeviceType;
  merchandiseType?: MerchandiseType;
  serialized: boolean;
  attributes?: Record<string, string>;
  unitCost: number;
  price?: number;
  reorderPoint: number;
  promotional?: boolean;
  barcode?: string;
  actor: string;
}

/** Patch of the editable product-master fields. */
export interface ProductPatch {
  name?: string;
  unitCost?: number;
  reorderPoint?: number;
  barcode?: string;
  promotional?: boolean;
  attributes?: Record<string, string>;
  price?: number;
}

export interface UpdateProductInput {
  productId: string;
  patch: ProductPatch;
  actor: string;
}

export interface AdjustStockInput {
  productId: string;
  locationId: string;
  /** Storage area to adjust (undefined = general area). */
  binId?: string;
  /** Signed quantity change (+ adds, − writes off). */
  quantityDelta: number;
  reason: string;
  actor: string;
}

/**
 * Storage-agnostic warehouse repository. Implemented by an in-memory/localStorage
 * adapter (offline + tests) and a Supabase adapter (live backend).
 */
export interface WarehouseRepository {
  getData(): Promise<WarehouseData>;
  getStockState(): Promise<StockState>;
  /** Demo staff accounts shown on the role-tile login screen. */
  getProfiles(): Promise<Profile[]>;

  receiveStock(input: ReceiveStockInput): Promise<Receipt>;
  reserve(input: ReserveInput): Promise<Allocation>;
  issue(input: IssueInput): Promise<Allocation>;
  recordReturn(input: ReturnInput): Promise<ReturnRecord>;
  recordCycleCount(input: CycleCountInput): Promise<CycleCount>;
  transfer(input: TransferInput): Promise<Movement[]>;
  createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder>;
  receiveAgainstPO(input: ReceiveAgainstPOInput): Promise<PurchaseOrder>;
  cancelPurchaseOrder(input: CancelPurchaseOrderInput): Promise<PurchaseOrder>;
  createEvent(input: CreateEventInput): Promise<WarehouseEvent>;
  cancelAllocation(input: CancelAllocationInput): Promise<Allocation>;
  createSupplier(input: CreateSupplierInput): Promise<Supplier>;
  updateSupplier(input: UpdateSupplierInput): Promise<Supplier>;
  createLocation(input: CreateLocationInput): Promise<Location>;
  updateLocation(input: UpdateLocationInput): Promise<Location>;
  deleteLocation(input: { locationId: string }): Promise<void>;
  createStorageArea(input: CreateStorageAreaInput): Promise<StorageArea>;
  updateStorageArea(input: UpdateStorageAreaInput): Promise<StorageArea>;
  deleteStorageArea(input: { storageAreaId: string }): Promise<void>;
  relocate(input: RelocateInput): Promise<Movement[]>;
  setProductPrice(input: SetProductPriceInput): Promise<Product>;
  createProduct(input: CreateProductInput): Promise<Product>;
  updateProduct(input: UpdateProductInput): Promise<Product>;
  adjustStock(input: AdjustStockInput): Promise<Movement>;
}

/** W1 control extension implemented by live and memory adapters in Task 5. */
export interface WarehouseControlRepository extends WarehouseRepository {
  listQualityInspections(query: PageQuery): Promise<PageResult<QualityInspection>>;
  listHolds(query: PageQuery): Promise<PageResult<InventoryHold>>;
  listVendorReturns(query: PageQuery): Promise<PageResult<VendorReturn>>;
  listExceptions(query: PageQuery): Promise<PageResult<WarehouseException>>;
  listStockChangeRequests(query: PageQuery): Promise<PageResult<StockChangeRequest>>;
  listWarehouseTasks(query: PageQuery): Promise<PageResult<WarehouseTask>>;
  listInventoryPositions(query: PageQuery): Promise<PageResult<InventoryPosition>>;
  inspectQuality(input: InspectQualityInput): Promise<QualityInspection>;
  releaseHold(input: ReleaseHoldInput): Promise<InventoryHold>;
  createVendorReturn(input: CreateVendorReturnInput): Promise<VendorReturn>;
  updateOperationRoute(input: UpdateOperationRouteInput): Promise<OperationRoute>;
  submitCycleCount(input: SubmitCycleCountInput): Promise<StockChangeRequest[]>;
  decideStockChange(input: DecideStockChangeInput): Promise<StockChangeRequest>;
  resolveException(input: ResolveExceptionInput): Promise<WarehouseException>;
  getReceivableProcurementPOs(): Promise<ProcurementPOHandoff[]>;
  receiveProcurementPO(input: ReceiveProcurementPOInput): Promise<Receipt>;
}

export function toStockState(data: WarehouseData): StockState {
  return {
    products: data.products,
    units: data.units,
    stockLevels: data.stockLevels,
  };
}
