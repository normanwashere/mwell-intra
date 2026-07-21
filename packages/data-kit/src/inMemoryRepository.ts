import type {
  Allocation,
  CycleCount,
  Location,
  Lot,
  Movement,
  PurchaseOrder,
  Receipt,
  ReturnRecord,
  StockLevel,
  StorageArea,
  Supplier,
  WarehouseEvent,
} from "./domain/types";
import {
  returnClosesAllocation,
  uncommittedAvailable,
  validateReservation,
} from "./domain/allocations";
import { primaryStockLocation, validateTransfer } from "./domain/transfers";
import { poStatusAfterReceipt } from "./domain/purchaseOrders";
import { applyProductPatch, buildNewProduct } from "./domain/products";
import {
  toStockState,
  type CancelAllocationInput,
  type CancelPurchaseOrderInput,
  type CreateEventInput,
  type CreateFulfillmentOrderInput,
  type AdvanceFulfillmentOrderInput,
  type CreateDepartmentStockRequestInput,
  type DecideDepartmentStockRequestInput,
  type CreateCustomerReturnCaseInput,
  type ResolveCustomerReturnCaseInput,
  type CreateKitDefinitionInput,
  type CreateReKitWorkOrderInput,
  type CompleteReKitWorkOrderInput,
  type CreateLocationInput,
  type CreateProductInput,
  type CreatePurchaseOrderInput,
  type CreateStorageAreaInput,
  type CreateSupplierInput,
  type CycleCountInput,
  type IssueInput,
  type ReceiveAgainstPOInput,
  type ReceiveStockInput,
  type RelocateInput,
  type ReserveInput,
  type ReturnInput,
  type SetProductPriceInput,
  type TransferInput,
  type UpdateLocationInput,
  type UpdateProductInput,
  type UpdateStorageAreaInput,
  type UpdateSupplierInput,
  type WarehouseData,
  type WarehouseControlRepository,
} from "./repository";
import {
  canReleaseFulfillmentOrder,
  nextFulfillmentStatus,
  validateDepartmentRequest,
  type CustomerReturnCase,
  type DepartmentStockRequest,
  type FulfillmentOrder,
  type KitDefinition,
  type ReKitWorkOrder,
} from "./domain/wms";
import type { Product, Profile } from "./domain/types";
import { buildProfiles, buildSeed } from "./seed";
import {
  availableAfterControls,
  normalizePageQuery,
  stockChangeStatusAfterDecision,
  type DecideStockChangeInput,
  type CreateVendorReturnInput,
  type InspectQualityInput,
  type InventoryHold,
  type InventoryPosition,
  type OperationRoute,
  type PageQuery,
  type PageResult,
  type ProcurementPOHandoff,
  type QualityInspection,
  type ReceiveProcurementPOInput,
  type RequestStockChangeInput,
  type ReleaseHoldInput,
  type ResolveExceptionInput,
  type StockChangeRequest,
  type SubmitCycleCountInput,
  type UpdateOperationRouteInput,
  type WarehouseControlPrincipal,
  type WarehouseException,
  type WarehouseTask,
  type VendorReturn,
} from "./domain/warehouseControls";

// v2 (2026-07): rich 90-day activity history added to the seed — bumping the
// key means browsers persisted on v1 pick up the new dataset on next load.
export const DATA_STORAGE_KEY = "mwell-intra-warehouse:data:v2";
const STORAGE_KEY = DATA_STORAGE_KEY;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${rand}`;
}

export interface InMemoryOptions {
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => string;
  id?: (prefix: string) => string;
}

export class InMemoryRepository implements WarehouseControlRepository {
  private data: WarehouseData;
  private storage: InMemoryOptions["storage"];
  private nowProvider: () => string;
  private idProvider: (prefix: string) => string;
  private qualityInspections: QualityInspection[] = [];
  private holds: InventoryHold[] = [];
  private vendorReturns: VendorReturn[] = [];
  private exceptions: WarehouseException[] = [];
  private stockChanges: StockChangeRequest[] = [];
  private operationRoutes: OperationRoute[] = [
    {
      id: "route-receipt-default",
      operationTypeId: "operation-receipt",
      sourceLocationTypes: ["vendor"],
      destinationLocationTypes: ["warehouse"],
      requiresEvidence: true,
      requiresApproval: false,
      requiresOnline: true,
      active: true,
    },
    {
      id: "route-receipt-controlled-alternate",
      operationTypeId: "operation-receipt",
      sourceLocationTypes: ["vendor"],
      destinationLocationTypes: ["warehouse"],
      requiresEvidence: true,
      requiresApproval: true,
      requiresOnline: true,
      active: false,
    },
  ];
  private commandResponses = new Map<
    string,
    { payload: string; response: unknown }
  >();

  constructor(initial?: WarehouseData, options: InMemoryOptions = {}) {
    this.storage = options.storage ?? null;
    this.nowProvider = options.now ?? (() => new Date().toISOString());
    this.idProvider = options.id ?? uid;
    const persisted = this.load();
    const source = persisted ?? clone(initial ?? buildSeed());
    this.data = {
      ...source,
      fulfillmentOrders: source.fulfillmentOrders ?? [],
      departmentStockRequests: source.departmentStockRequests ?? [],
      customerReturnCases: source.customerReturnCases ?? [],
      kitDefinitions: source.kitDefinitions ?? [],
      reKitWorkOrders: source.reKitWorkOrders ?? [],
    };
  }

  private load(): WarehouseData | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as WarehouseData) : null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (err) {
      // Surface quota failures so a large evidence photo can't silently drop a
      // receipt/movement on reload.
      if (
        typeof window !== "undefined" &&
        err instanceof DOMException &&
        (err.name === "QuotaExceededError" ||
          err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
          err.code === 22)
      ) {
        window.dispatchEvent(
          new CustomEvent("intra:storage-full", {
            detail: { key: STORAGE_KEY },
          }),
        );
      }
    }
  }

  private now(): string {
    return this.nowProvider();
  }

  private newId(prefix: string): string {
    return this.idProvider(prefix);
  }

  private idempotent<T>(
    command: string,
    key: string,
    input: unknown,
    execute: () => T,
  ): T {
    if (!/^[A-Za-z0-9_-]{12,128}$/.test(key)) {
      throw new Error("A valid idempotency key is required.");
    }
    const cacheKey = `${command}:${key}`;
    const payload = JSON.stringify(input);
    const existing = this.commandResponses.get(cacheKey);
    if (existing) {
      if (existing.payload !== payload) {
        throw new Error("Idempotency key was reused with a different payload.");
      }
      return clone(existing.response as T);
    }
    const response = execute();
    this.commandResponses.set(cacheKey, { payload, response: clone(response) });
    return clone(response);
  }

  private page<T extends { id: string }>(
    rows: T[],
    query: PageQuery,
    status: (row: T) => string | undefined,
  ): PageResult<T> {
    const normalized = normalizePageQuery(query);
    const filtered = rows
      .filter((row) => !normalized.status || status(row) === normalized.status)
      .sort((a, b) => b.id.localeCompare(a.id));
    const offset = normalized.cursor ? Number(normalized.cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0)
      throw new Error("Invalid page cursor.");
    const pageRows = filtered.slice(offset, offset + normalized.limit);
    return {
      rows: clone(pageRows),
      ...(offset + normalized.limit < filtered.length
        ? { nextCursor: String(offset + normalized.limit) }
        : {}),
      total: filtered.length,
    };
  }

  /** Find (or optionally create) the stock row for a product/location/bin. */
  private stockRow(
    productId: string,
    locationId: string,
    binId: string | undefined,
    create: boolean,
  ): StockLevel | undefined {
    let level = this.data.stockLevels.find(
      (s) =>
        s.productId === productId &&
        s.locationId === locationId &&
        (s.binId ?? undefined) === (binId ?? undefined),
    );
    if (!level && create) {
      level = { productId, locationId, binId, quantity: 0 };
      this.data.stockLevels.push(level);
    }
    return level;
  }

  async getData(): Promise<WarehouseData> {
    return clone({ ...this.data, operationRoutes: this.operationRoutes });
  }

  async getStockState() {
    return clone(toStockState(this.data));
  }

  async getProfiles(): Promise<Profile[]> {
    return buildProfiles();
  }

  async receiveStock(input: ReceiveStockInput): Promise<Receipt> {
    const createdAt = this.now();
    const receipt: Receipt = {
      id: uid("rcpt"),
      supplierId: input.supplierId,
      actualDeliveryDate: input.actualDeliveryDate,
      deliveryReference: input.deliveryReference,
      courierOrDriver: input.courierOrDriver,
      locationId: input.locationId,
      lines: input.lines,
      evidenceUrls: input.evidenceUrls,
      actor: input.actor,
      createdAt,
    };

    for (const line of input.lines) {
      const product = this.data.products.find((p) => p.id === line.productId);
      if (!product) throw new Error(`Unknown product: ${line.productId}`);

      // Capture a lot whenever a unit cost or lot code is supplied so receipts
      // feed landed-cost / pricing analytics.
      let lotId: string | undefined;
      if (line.unitCost != null || line.lotCode || line.expiryDate) {
        const lot: Lot = {
          id: uid("lot"),
          productId: product.id,
          lotCode: line.lotCode ?? `LOT-${product.sku}-${Date.now()}`,
          supplierId: input.supplierId,
          unitCost: line.unitCost ?? product.unitCost,
          receivedAt: createdAt,
          expiryDate: line.expiryDate,
        };
        this.data.lots.push(lot);
        lotId = lot.id;
      }

      if (product.serialized) {
        const serials =
          line.serialNumbers && line.serialNumbers.length > 0
            ? line.serialNumbers
            : Array.from(
                { length: line.quantity },
                (_, i) => `${product.sku}-SN${Date.now()}${i}`,
              );
        for (const serialNumber of serials) {
          this.data.units.push({
            id: uid("unit"),
            productId: product.id,
            serialNumber,
            lotId,
            locationId: input.locationId,
            binId: line.binId,
            status: "in_stock",
          });
        }
      } else {
        const level = this.stockRow(
          product.id,
          input.locationId,
          line.binId,
          true,
        )!;
        level.quantity += line.quantity;
      }

      this.data.movements.push({
        id: uid("mv"),
        type: "receipt",
        productId: product.id,
        quantity: line.quantity,
        toLocationId: input.locationId,
        toBinId: line.binId,
        lotId,
        reference: receipt.id,
        evidenceUrls: input.evidenceUrls,
        actor: input.actor,
        createdAt,
      });
    }

    this.data.receipts.push(receipt);
    this.persist();
    return clone(receipt);
  }

  async reserve(input: ReserveInput): Promise<Allocation> {
    const state = toStockState(this.data);
    const result = validateReservation(
      state,
      this.data.allocations,
      input.productId,
      input.quantity,
    );
    if (!result.ok) throw new Error(result.error);
    const held = this.holds
      .filter(
        (hold) =>
          hold.status === "active" && hold.productId === input.productId,
      )
      .reduce((sum, hold) => sum + hold.quantity, 0);
    const available = Math.max(
      0,
      uncommittedAvailable(state, this.data.allocations, input.productId) -
        held,
    );
    if (input.quantity > available) {
      throw new Error(
        `Cannot reserve ${input.quantity} - only ${available} available after active holds.`,
      );
    }

    const allocation: Allocation = {
      id: uid("alloc"),
      eventId: input.eventId,
      productId: input.productId,
      quantity: input.quantity,
      status: "reserved",
      promotional: input.promotional,
      createdAt: this.now(),
    };
    this.data.allocations.push(allocation);
    this.persist();
    return clone(allocation);
  }

  async issue(input: IssueInput): Promise<Allocation> {
    const allocation = this.data.allocations.find(
      (a) => a.id === input.allocationId,
    );
    if (!allocation) throw new Error("Allocation not found.");
    if (allocation.status === "issued")
      throw new Error("Allocation already issued.");

    const product = this.data.products.find(
      (p) => p.id === allocation.productId,
    );
    if (!product) throw new Error("Product not found.");
    const createdAt = this.now();

    // Resolve the source location: explicit input, else the location holding stock.
    const sourceLocationId =
      input.sourceLocationId ??
      primaryStockLocation(toStockState(this.data), product.id);

    if (product.serialized) {
      const serials = input.serialNumbers ?? [];
      let toIssue = allocation.quantity;
      const candidates = this.data.units.filter(
        (u) =>
          u.productId === product.id &&
          u.status === "in_stock" &&
          (sourceLocationId === undefined ||
            u.locationId === sourceLocationId) &&
          (input.sourceBinId === undefined || u.binId === input.sourceBinId),
      );
      const toFlip: typeof candidates = [];
      for (const unit of candidates) {
        if (toIssue <= 0) break;
        if (serials.length > 0 && !serials.includes(unit.serialNumber))
          continue;
        toFlip.push(unit);
        toIssue--;
      }
      // Refuse to mark the allocation issued unless enough in-stock units back it.
      if (toIssue > 0) {
        throw new Error(
          `Only ${allocation.quantity - toIssue} of ${allocation.quantity} unit(s) available to issue.`,
        );
      }
      for (const unit of toFlip) {
        unit.status = "issued";
        unit.assignedTo = input.assignedTo;
        unit.eventId = allocation.eventId;
      }
    } else {
      const levels = this.data.stockLevels.filter(
        (s) =>
          s.productId === product.id &&
          (sourceLocationId === undefined ||
            s.locationId === sourceLocationId) &&
          (input.sourceBinId === undefined ||
            (s.binId ?? undefined) === input.sourceBinId),
      );
      const total = levels.reduce((sum, s) => sum + s.quantity, 0);
      if (total < allocation.quantity) {
        throw new Error(
          `Insufficient stock to issue ${allocation.quantity} at the selected source.`,
        );
      }
      // Draw down across matching bins/lots (bin-scoped when a bin was chosen).
      let remaining = allocation.quantity;
      for (const level of levels) {
        if (remaining <= 0) break;
        const take = Math.min(level.quantity, remaining);
        level.quantity -= take;
        remaining -= take;
      }
    }

    allocation.status = "issued";
    this.data.movements.push({
      id: uid("mv"),
      type: "issue",
      productId: product.id,
      quantity: allocation.quantity,
      fromLocationId: sourceLocationId,
      fromBinId: input.sourceBinId,
      eventId: allocation.eventId,
      reference: allocation.id,
      evidenceUrls: input.evidenceUrls,
      actor: input.actor,
      createdAt,
    });
    this.persist();
    return clone(allocation);
  }

  async recordReturn(input: ReturnInput): Promise<ReturnRecord> {
    const createdAt = this.now();
    const record: ReturnRecord = {
      id: uid("ret"),
      source: input.source,
      eventId: input.eventId,
      lines: input.lines,
      evidenceUrls: input.evidenceUrls,
      actor: input.actor,
      createdAt,
    };

    for (const line of input.lines) {
      const product = this.data.products.find((p) => p.id === line.productId);
      if (!product) throw new Error(`Unknown product: ${line.productId}`);

      const disposition = line.disposition ?? "restock";

      if (product.serialized && line.serialNumber) {
        const unit = this.data.units.find(
          (u) =>
            u.serialNumber === line.serialNumber && u.productId === product.id,
        );
        // A return that references a serial we can't find (typo / wrong SKU)
        // would otherwise log a movement and close the allocation while no unit
        // actually changes state — leaving ghost issued units. Refuse it.
        if (!unit) {
          throw new Error(
            `Serial ${line.serialNumber} not found for ${product.name}.`,
          );
        }
        if (disposition === "restock") {
          unit.status = "in_stock";
          unit.assignedTo = undefined;
          if (line.locationId) unit.locationId = line.locationId;
          if (line.binId !== undefined) unit.binId = line.binId;
        } else if (disposition === "lost") {
          unit.status = "lost";
          unit.assignedTo = undefined;
        } else {
          unit.status = "returned";
          unit.assignedTo = undefined;
        }
      } else if (!product.serialized) {
        if (disposition === "restock") {
          const targetLoc =
            line.locationId ??
            primaryStockLocation(toStockState(this.data), product.id);
          if (targetLoc) {
            const level = this.stockRow(
              product.id,
              targetLoc,
              line.binId,
              true,
            )!;
            level.quantity += line.quantity;
          }
        }
      }

      this.data.movements.push({
        id: uid("mv"),
        type: "return",
        productId: product.id,
        quantity: line.quantity,
        toLocationId: line.locationId,
        toBinId: line.binId,
        eventId: input.eventId,
        reason: `${line.reason} (${disposition})`,
        serialNumber: line.serialNumber,
        reference: record.id,
        evidenceUrls: input.evidenceUrls,
        actor: input.actor,
        createdAt,
      });
    }

    // Close out the originating allocation only when this return fully accounts
    // for it. Partial serialized returns keep the allocation `issued` until all
    // issued units have come back.
    if (input.allocationId) {
      const allocation = this.data.allocations.find(
        (a) => a.id === input.allocationId,
      );
      if (allocation && allocation.status === "issued") {
        const product = this.data.products.find(
          (p) => p.id === allocation.productId,
        );
        if (
          returnClosesAllocation(
            allocation,
            product,
            input.lines,
            this.data.units,
          )
        ) {
          allocation.status = "returned";
        }
      }
    }

    this.data.returns.push(record);
    this.persist();
    return clone(record);
  }

  async recordCycleCount(input: CycleCountInput): Promise<CycleCount> {
    const createdAt = this.now();
    const count: CycleCount = {
      id: uid("cc"),
      locationId: input.locationId,
      binId: input.binId,
      category: input.category,
      lines: input.lines,
      status: "draft",
      requestedBy: input.requesterId ?? input.actor,
      actor: input.actor,
      createdAt,
    };

    this.data.cycleCounts.push(count);
    this.persist();
    return clone(count);
  }

  async transfer(input: TransferInput): Promise<Movement[]> {
    const result = validateTransfer(
      toStockState(this.data),
      input.productId,
      input.fromLocationId,
      input.toLocationId,
      input.quantity,
    );
    if (!result.ok) throw new Error(result.error);

    const product = this.data.products.find((p) => p.id === input.productId);
    if (!product) throw new Error(`Unknown product: ${input.productId}`);
    const createdAt = this.now();

    if (product.serialized) {
      const serials = input.serialNumbers ?? [];
      let toMove = input.quantity;
      const candidates = this.data.units.filter(
        (u) =>
          u.productId === product.id &&
          u.status === "in_stock" &&
          u.locationId === input.fromLocationId &&
          (input.fromBinId === undefined || u.binId === input.fromBinId),
      );
      const toFlip: typeof candidates = [];
      for (const unit of candidates) {
        if (toMove <= 0) break;
        if (serials.length > 0 && !serials.includes(unit.serialNumber))
          continue;
        toFlip.push(unit);
        toMove--;
      }
      // Don't log a transfer of units that aren't actually at the source bin.
      if (toMove > 0) {
        throw new Error(
          `Only ${input.quantity - toMove} of ${input.quantity} unit(s) available at the source.`,
        );
      }
      for (const unit of toFlip) {
        unit.locationId = input.toLocationId;
        unit.binId = input.toBinId;
      }
    } else {
      const fromLevel = this.stockRow(
        product.id,
        input.fromLocationId,
        input.fromBinId,
        false,
      );
      // Guard against crediting the destination when the source bin can't cover
      // the move — otherwise stock is duplicated.
      if (!fromLevel || fromLevel.quantity < input.quantity) {
        throw new Error(
          `Insufficient stock in the selected source bin to transfer ${input.quantity}.`,
        );
      }
      fromLevel.quantity -= input.quantity;
      const toLevel = this.stockRow(
        product.id,
        input.toLocationId,
        input.toBinId,
        true,
      )!;
      toLevel.quantity += input.quantity;
    }

    const movement: Movement = {
      id: uid("mv"),
      type: "transfer",
      productId: product.id,
      quantity: input.quantity,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      fromBinId: input.fromBinId,
      toBinId: input.toBinId,
      actor: input.actor,
      createdAt,
    };
    this.data.movements.push(movement);
    this.persist();
    return clone([movement]);
  }

  async createPurchaseOrder(
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrder> {
    const po: PurchaseOrder = {
      id: uid("po"),
      supplierId: input.supplierId,
      status: "ordered",
      lines: input.lines.map((l) => ({
        productId: l.productId,
        quantityOrdered: l.quantityOrdered,
        quantityReceived: 0,
      })),
      expectedDate: input.expectedDate,
      actor: input.actor,
      createdAt: this.now(),
    };
    this.data.purchaseOrders.push(po);
    this.persist();
    return clone(po);
  }

  async receiveAgainstPO(input: ReceiveAgainstPOInput): Promise<PurchaseOrder> {
    const po = this.data.purchaseOrders.find((p) => p.id === input.poId);
    if (!po) throw new Error("Purchase order not found.");
    if (po.status === "cancelled")
      throw new Error("Cannot receive against a cancelled purchase order.");
    const createdAt = this.now();

    for (const line of input.lines) {
      if (line.quantityReceived <= 0) continue;
      const product = this.data.products.find((p) => p.id === line.productId);
      if (!product) throw new Error(`Unknown product: ${line.productId}`);

      const poLine = po.lines.find((l) => l.productId === line.productId);
      // A received line for a product not on the PO is invalid.
      if (!poLine)
        throw new Error(
          `Received product is not on this PO: ${line.productId}`,
        );
      // Never let cumulative received exceed what was ordered.
      poLine.quantityReceived = Math.min(
        poLine.quantityOrdered,
        poLine.quantityReceived + line.quantityReceived,
      );

      if (product.serialized) {
        for (let i = 0; i < line.quantityReceived; i++) {
          this.data.units.push({
            id: uid("unit"),
            productId: product.id,
            serialNumber: `${product.sku}-SN${Date.now()}${i}`,
            locationId: input.locationId,
            binId: input.binId,
            status: "in_stock",
          });
        }
      } else {
        const level = this.stockRow(
          product.id,
          input.locationId,
          input.binId,
          true,
        )!;
        level.quantity += line.quantityReceived;
      }

      this.data.movements.push({
        id: uid("mv"),
        type: "receipt",
        productId: product.id,
        quantity: line.quantityReceived,
        toLocationId: input.locationId,
        toBinId: input.binId,
        reference: po.id,
        actor: input.actor,
        createdAt,
      });
    }

    po.status = poStatusAfterReceipt(po);
    this.persist();
    return clone(po);
  }

  async cancelPurchaseOrder(
    input: CancelPurchaseOrderInput,
  ): Promise<PurchaseOrder> {
    const po = this.data.purchaseOrders.find((p) => p.id === input.poId);
    if (!po) throw new Error("Purchase order not found.");
    if (po.status === "received")
      throw new Error("Cannot cancel a fully received purchase order.");
    if (po.status === "cancelled")
      throw new Error("Purchase order already cancelled.");
    po.status = "cancelled";
    this.persist();
    return clone(po);
  }

  async createEvent(input: CreateEventInput): Promise<WarehouseEvent> {
    const event: WarehouseEvent = {
      id: uid("evt"),
      name: input.name,
      type: input.type,
      siteLocationId: input.siteLocationId,
      startDate: input.startDate,
      endDate: input.endDate,
    };
    this.data.events.push(event);
    this.persist();
    return clone(event);
  }

  async cancelAllocation(input: CancelAllocationInput): Promise<Allocation> {
    const allocation = this.data.allocations.find(
      (a) => a.id === input.allocationId,
    );
    if (!allocation) throw new Error("Allocation not found.");
    if (allocation.status === "issued")
      throw new Error("Cannot cancel an issued allocation.");

    allocation.status = "cancelled";
    this.persist();
    return clone(allocation);
  }

  async createSupplier(input: CreateSupplierInput): Promise<Supplier> {
    if (!input.name.trim()) throw new Error("Supplier name is required.");
    const supplier: Supplier = {
      id: uid("sup"),
      name: input.name.trim(),
      leadTimeDays: input.leadTimeDays,
    };
    this.data.suppliers.push(supplier);
    this.persist();
    return clone(supplier);
  }

  async updateSupplier(input: UpdateSupplierInput): Promise<Supplier> {
    const supplier = this.data.suppliers.find((s) => s.id === input.supplierId);
    if (!supplier) throw new Error("Supplier not found.");
    if (!input.name.trim()) throw new Error("Supplier name is required.");
    supplier.name = input.name.trim();
    supplier.leadTimeDays = input.leadTimeDays;
    this.persist();
    return clone(supplier);
  }

  async createLocation(input: CreateLocationInput): Promise<Location> {
    if (!input.name.trim()) throw new Error("Location name is required.");
    const id = input.id?.trim() || uid("loc");
    if (this.data.locations.some((l) => l.id === id))
      throw new Error("A location with that ID already exists.");
    const location: Location = {
      id,
      name: input.name.trim(),
      type: input.type,
    };
    this.data.locations.push(location);
    this.persist();
    return clone(location);
  }

  async updateLocation(input: UpdateLocationInput): Promise<Location> {
    const location = this.data.locations.find((l) => l.id === input.locationId);
    if (!location) throw new Error("Location not found.");
    if (!input.name.trim()) throw new Error("Location name is required.");
    location.name = input.name.trim();
    location.type = input.type;
    this.persist();
    return clone(location);
  }

  async deleteLocation(input: { locationId: string }): Promise<void> {
    const i = this.data.locations.findIndex((l) => l.id === input.locationId);
    if (i < 0) throw new Error("Location not found.");
    const hasStock =
      this.data.stockLevels.some(
        (s) => s.locationId === input.locationId && s.quantity > 0,
      ) ||
      this.data.units.some(
        (u) => u.locationId === input.locationId && u.status === "in_stock",
      );
    if (hasStock) {
      throw new Error(
        "Cannot delete a location that still holds stock. Transfer or write off its stock first.",
      );
    }
    this.data.locations.splice(i, 1);
    this.persist();
  }

  async createStorageArea(input: CreateStorageAreaInput): Promise<StorageArea> {
    if (!input.code.trim()) throw new Error("A bin code is required.");
    const id = input.id?.trim() || uid("bin");
    if (
      this.data.storageAreas.some(
        (b) =>
          b.locationId === input.locationId &&
          b.code.toLowerCase() === input.code.trim().toLowerCase(),
      )
    ) {
      throw new Error(`Bin code "${input.code.trim()}" already exists here.`);
    }
    const area: StorageArea = {
      id,
      locationId: input.locationId,
      code: input.code.trim(),
      label: input.label?.trim() || undefined,
      zone: input.zone?.trim() || undefined,
      active: true,
    };
    this.data.storageAreas.push(area);
    this.persist();
    return clone(area);
  }

  async updateStorageArea(input: UpdateStorageAreaInput): Promise<StorageArea> {
    const area = this.data.storageAreas.find(
      (b) => b.id === input.storageAreaId,
    );
    if (!area) throw new Error("Storage area not found.");
    if (!input.code.trim()) throw new Error("A bin code is required.");
    area.code = input.code.trim();
    area.label = input.label?.trim() || undefined;
    area.zone = input.zone?.trim() || undefined;
    if (input.active !== undefined) area.active = input.active;
    this.persist();
    return clone(area);
  }

  async deleteStorageArea(input: { storageAreaId: string }): Promise<void> {
    const i = this.data.storageAreas.findIndex(
      (b) => b.id === input.storageAreaId,
    );
    if (i < 0) throw new Error("Storage area not found.");
    // Clear the bin off any stock/units that referenced it (back to general area).
    for (const u of this.data.units) {
      if (u.binId === input.storageAreaId) u.binId = undefined;
    }
    for (const s of this.data.stockLevels) {
      if (s.binId === input.storageAreaId) s.binId = undefined;
    }
    this.data.storageAreas.splice(i, 1);
    this.persist();
  }

  async relocate(input: RelocateInput): Promise<Movement[]> {
    if (input.quantity <= 0)
      throw new Error("Quantity must be greater than zero.");
    if ((input.fromBinId ?? undefined) === (input.toBinId ?? undefined)) {
      throw new Error("Source and destination bins must differ.");
    }
    const product = this.data.products.find((p) => p.id === input.productId);
    if (!product) throw new Error("Product not found.");
    const createdAt = this.now();

    if (product.serialized) {
      const serials = input.serialNumbers ?? [];
      let toMove = input.quantity;
      const candidates = this.data.units.filter(
        (u) =>
          u.productId === product.id &&
          u.status === "in_stock" &&
          u.locationId === input.locationId &&
          (u.binId ?? undefined) === (input.fromBinId ?? undefined),
      );
      for (const unit of candidates) {
        if (toMove <= 0) break;
        if (serials.length > 0 && !serials.includes(unit.serialNumber))
          continue;
        unit.binId = input.toBinId;
        toMove--;
      }
    } else {
      const fromLevel = this.stockRow(
        product.id,
        input.locationId,
        input.fromBinId,
        false,
      );
      const available = fromLevel?.quantity ?? 0;
      if (available < input.quantity) {
        throw new Error(
          `Cannot move ${input.quantity} — only ${available} in the source bin.`,
        );
      }
      fromLevel!.quantity -= input.quantity;
      const toLevel = this.stockRow(
        product.id,
        input.locationId,
        input.toBinId,
        true,
      )!;
      toLevel.quantity += input.quantity;
    }

    const movement: Movement = {
      id: uid("mv"),
      type: "transfer",
      productId: product.id,
      quantity: input.quantity,
      fromLocationId: input.locationId,
      toLocationId: input.locationId,
      fromBinId: input.fromBinId,
      toBinId: input.toBinId,
      reason: "bin relocation",
      actor: input.actor,
      createdAt,
    };
    this.data.movements.push(movement);
    this.persist();
    return clone([movement]);
  }

  async setProductPrice(input: SetProductPriceInput) {
    const product = this.data.products.find((p) => p.id === input.productId);
    if (!product) throw new Error("Product not found.");
    if (Number.isNaN(input.price) || input.price < 0)
      throw new Error("Price must be zero or more.");
    product.price = input.price;
    this.persist();
    return clone(product);
  }

  async createProduct(input: CreateProductInput): Promise<Product> {
    const product = buildNewProduct(uid("prod"), input, this.data.products);
    this.data.products.push(product);
    this.persist();
    return clone(product);
  }

  async updateProduct(input: UpdateProductInput): Promise<Product> {
    const index = this.data.products.findIndex((p) => p.id === input.productId);
    if (index === -1) throw new Error("Product not found.");
    // `index !== -1` guarantees the row exists; the local const keeps this
    // type-safe under `noUncheckedIndexedAccess` without changing behaviour.
    const existing = this.data.products[index];
    if (!existing) throw new Error("Product not found.");
    const next = applyProductPatch(existing, input.patch);
    this.data.products[index] = next;
    this.persist();
    return clone(next);
  }

  async listQualityInspections(
    query: PageQuery,
  ): Promise<PageResult<QualityInspection>> {
    return this.page(this.qualityInspections, query, (row) => row.disposition);
  }

  async listHolds(query: PageQuery): Promise<PageResult<InventoryHold>> {
    return this.page(this.holds, query, (row) => row.status);
  }

  async listVendorReturns(query: PageQuery): Promise<PageResult<VendorReturn>> {
    return this.page(this.vendorReturns, query, (row) => row.status);
  }

  async listExceptions(
    query: PageQuery,
  ): Promise<PageResult<WarehouseException>> {
    return this.page(this.exceptions, query, (row) => row.status);
  }

  async listStockChangeRequests(
    query: PageQuery,
  ): Promise<PageResult<StockChangeRequest>> {
    return this.page(this.stockChanges, query, (row) => row.status);
  }

  async listWarehouseTasks(
    query: PageQuery,
  ): Promise<PageResult<WarehouseTask>> {
    const tasks: WarehouseTask[] = [
      ...this.holds
        .filter((hold) => hold.status === "active")
        .map((hold) => ({
          id: `quality-${hold.id}`,
          type: "quality" as const,
          sourceId: hold.id,
          title: `Review hold for ${hold.productId}`,
          status: "blocked" as const,
        })),
      ...this.exceptions
        .filter((exception) =>
          ["open", "in_progress"].includes(exception.status),
        )
        .map((exception) => ({
          id: `exception-${exception.id}`,
          type: "exception" as const,
          sourceId: exception.id,
          title: `Resolve ${exception.type.replace("_", " ")}`,
          status: "due" as const,
          assigneeId: exception.ownerId,
          dueAt: exception.dueAt,
        })),
    ];
    return this.page(tasks, query, (row) => row.status);
  }

  async listInventoryPositions(
    query: PageQuery,
  ): Promise<PageResult<InventoryPosition>> {
    const positions = new Map<string, InventoryPosition>();
    const position = (
      productId: string,
      locationId: string,
      binId?: string,
    ) => {
      const key = `${productId}|${locationId}|${binId ?? ""}`;
      let row = positions.get(key);
      if (!row) {
        row = {
          productId,
          locationId,
          binId,
          onHand: 0,
          committed: 0,
          held: 0,
          unavailable: 0,
          available: 0,
        };
        positions.set(key, row);
      }
      return row;
    };
    for (const level of this.data.stockLevels) {
      position(level.productId, level.locationId, level.binId).onHand +=
        level.quantity;
    }
    for (const unit of this.data.units) {
      if (unit.status === "in_stock") {
        position(unit.productId, unit.locationId, unit.binId).onHand += 1;
      } else if (unit.status === "returned") {
        const row = position(unit.productId, unit.locationId, unit.binId);
        row.onHand += 1;
        row.unavailable += 1;
      }
    }
    for (const hold of this.holds.filter((row) => row.status === "active")) {
      position(hold.productId, hold.locationId, hold.binId).held +=
        hold.quantity;
    }
    const rows = [...positions.entries()]
      .map(([id, row]) => ({
        id,
        ...row,
        available: availableAfterControls(row),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const normalized = normalizePageQuery(query);
    const offset = normalized.cursor ? Number(normalized.cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0)
      throw new Error("Invalid page cursor.");
    const selected = rows.slice(offset, offset + normalized.limit);
    return {
      rows: clone(selected.map(({ id: _id, ...row }) => row)),
      ...(offset + normalized.limit < rows.length
        ? { nextCursor: String(offset + normalized.limit) }
        : {}),
      total: rows.length,
    };
  }

  async inspectQuality(input: InspectQualityInput): Promise<QualityInspection> {
    return this.idempotent(
      "inspect_quality",
      input.idempotencyKey,
      input,
      () => {
        const receipt =
          input.sourceType === "receipt"
            ? this.data.receipts.find((row) => row.id === input.sourceId)
            : undefined;
        const returned =
          input.sourceType === "return"
            ? this.data.returns.find((row) => row.id === input.sourceId)
            : undefined;
        if (!receipt && !returned) throw new Error("Quality source not found.");
        const lines = receipt?.lines ?? returned?.lines ?? [];
        const sourceQuantity = lines
          .filter((line) => line.productId === input.productId)
          .reduce((sum, line) => sum + line.quantity, 0);
        if (input.quantity <= 0 || input.quantity > sourceQuantity) {
          throw new Error("Inspection quantity exceeds the source quantity.");
        }
        if (input.disposition !== "accepted" && !input.reason?.trim()) {
          throw new Error("A reason is required for non-accepted stock.");
        }
        const locationId =
          receipt?.locationId ??
          returned?.lines.find((line) => line.productId === input.productId)
            ?.locationId;
        if (!locationId)
          throw new Error("Inspection location cannot be resolved.");
        const inspection: QualityInspection = {
          id: this.newId("qi"),
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          productId: input.productId,
          binId: input.binId,
          lotId: input.lotId,
          serialNumber: input.serialNumber,
          quantity: input.quantity,
          disposition: input.disposition,
          reason: input.reason,
          evidenceUrls: input.evidenceUrls ?? [],
          inspectedBy: "demo-quality-inspector",
          inspectedAt: this.now(),
        };
        this.qualityInspections.push(inspection);
        if (input.disposition !== "accepted") {
          const hold: InventoryHold = {
            id: this.newId("hold"),
            inspectionId: inspection.id,
            productId: input.productId,
            locationId,
            binId: input.binId,
            lotId: input.lotId,
            serialNumber: input.serialNumber,
            quantity: input.quantity,
            status: "active",
            reason: input.reason!,
            createdBy: inspection.inspectedBy,
            createdAt: inspection.inspectedAt,
          };
          this.holds.push(hold);
          this.exceptions.push({
            id: this.newId("ex"),
            type: "quality",
            severity: "P2",
            sourceType: "quality_inspection",
            sourceId: inspection.id,
            status: "open",
            createdAt: inspection.inspectedAt,
          });
        }
        this.persist();
        return inspection;
      },
    );
  }

  async releaseHold(input: ReleaseHoldInput): Promise<InventoryHold> {
    return this.idempotent("release_hold", input.idempotencyKey, input, () => {
      if (input.targetDisposition !== "accepted") {
        throw new Error("Only accepted stock can be released from a hold.");
      }
      if (!input.reason.trim() || !input.evidenceUrls?.length) {
        throw new Error("Release reason and evidence are required.");
      }
      const hold = this.holds.find(
        (row) => row.id === input.holdId && row.status === "active",
      );
      if (!hold) throw new Error("Active hold not found.");
      hold.status = "released";
      hold.releasedBy = "demo-logistics-supervisor";
      hold.releasedAt = this.now();
      const inspection = this.qualityInspections.find(
        (row) => row.id === hold.inspectionId,
      );
      if (inspection) inspection.disposition = "accepted";
      const exception = this.exceptions.find(
        (row) =>
          row.sourceType === "quality_inspection" &&
          row.sourceId === hold.inspectionId,
      );
      if (exception) {
        exception.status = "resolved";
        exception.resolution = input.reason;
      }
      this.persist();
      return hold;
    });
  }

  async createVendorReturn(
    input: CreateVendorReturnInput,
  ): Promise<VendorReturn> {
    return this.idempotent(
      "create_vendor_return",
      input.idempotencyKey,
      input,
      () => {
        if (!input.reason.trim() || !input.reference.trim()) {
          throw new Error("Vendor return reason and reference are required.");
        }
        const hold = this.holds.find(
          (row) => row.id === input.holdId && row.status === "active",
        );
        if (!hold) throw new Error("Active hold not found.");
        const inspection = this.qualityInspections.find(
          (row) => row.id === hold.inspectionId,
        );
        if (!inspection || inspection.disposition !== "vendor_return") {
          throw new Error("The inspection is not marked for vendor return.");
        }
        const supplier = this.data.suppliers.find(
          (row) => row.id === input.supplierId,
        );
        if (!supplier) throw new Error("Supplier not found.");
        if (inspection.sourceType === "receipt") {
          const receipt = this.data.receipts.find(
            (row) => row.id === inspection.sourceId,
          );
          if (receipt?.supplierId && receipt.supplierId !== input.supplierId) {
            throw new Error(
              "Vendor return supplier must match the source receipt.",
            );
          }
        }
        if (hold.serialNumber) {
          const unit = this.data.units.find(
            (row) =>
              row.productId === hold.productId &&
              row.serialNumber === hold.serialNumber &&
              row.locationId === hold.locationId &&
              ["in_stock", "returned"].includes(row.status),
          );
          if (!unit)
            throw new Error(
              "Held serialized unit is not available for vendor return.",
            );
          unit.status = "vendor_return";
          unit.assignedTo = undefined;
        } else {
          const level = this.data.stockLevels.find(
            (row) =>
              row.productId === hold.productId &&
              row.locationId === hold.locationId &&
              (row.binId ?? undefined) === (hold.binId ?? undefined) &&
              (row.lotId ?? undefined) === (hold.lotId ?? undefined),
          );
          if (!level || level.quantity < hold.quantity) {
            throw new Error(
              "Held quantity is not available for vendor return.",
            );
          }
          level.quantity -= hold.quantity;
        }
        const createdAt = this.now();
        const vendorReturn: VendorReturn = {
          id: this.newId("vr"),
          holdId: hold.id,
          supplierId: input.supplierId,
          ...(inspection.sourceType === "receipt"
            ? { sourceReceiptId: inspection.sourceId }
            : { sourceReturnId: inspection.sourceId }),
          productId: hold.productId,
          ...(hold.lotId ? { lotId: hold.lotId } : {}),
          ...(hold.serialNumber ? { serialNumber: hold.serialNumber } : {}),
          quantity: hold.quantity,
          reason: input.reason.trim(),
          reference: input.reference.trim(),
          status: "ready",
          evidenceUrls: input.evidenceUrls ?? [],
          createdBy: "demo-logistics-supervisor",
          createdAt,
        };
        this.vendorReturns.push(vendorReturn);
        hold.status = "vendor_return";
        hold.releasedBy = vendorReturn.createdBy;
        hold.releasedAt = createdAt;
        this.data.movements.push({
          id: this.newId("mv"),
          type: "vendor_return",
          productId: hold.productId,
          quantity: hold.quantity,
          fromLocationId: hold.locationId,
          fromBinId: hold.binId,
          lotId: hold.lotId,
          serialNumber: hold.serialNumber,
          reason: vendorReturn.reason,
          reference: vendorReturn.id,
          evidenceUrls: vendorReturn.evidenceUrls,
          actor: vendorReturn.createdBy,
          createdAt,
        });
        const exception = this.exceptions.find(
          (row) =>
            row.sourceType === "quality_inspection" &&
            row.sourceId === inspection.id &&
            ["open", "in_progress"].includes(row.status),
        );
        if (exception) {
          exception.status = "resolved";
          exception.resolution = `Vendor return ${vendorReturn.reference} created`;
        }
        this.persist();
        return vendorReturn;
      },
    );
  }

  async updateOperationRoute(
    input: UpdateOperationRouteInput,
  ): Promise<OperationRoute> {
    return this.idempotent(
      "update_operation_route",
      input.idempotencyKey,
      input,
      () => {
        const route = this.operationRoutes.find(
          (row) => row.id === input.routeId,
        );
        if (!route) throw new Error("Operation route not found.");
        if (
          route.active &&
          input.patch.active === false &&
          !this.operationRoutes.some(
            (other) =>
              other.id !== route.id &&
              other.operationTypeId === route.operationTypeId &&
              other.active,
          )
        ) {
          throw new Error(
            "The last active route for an operation type cannot be disabled.",
          );
        }
        Object.assign(route, input.patch);
        return route;
      },
    );
  }

  async submitCycleCount(
    input: SubmitCycleCountInput,
  ): Promise<StockChangeRequest[]> {
    return this.idempotent(
      "submit_cycle_count",
      input.idempotencyKey,
      input,
      () => {
        const count = this.data.cycleCounts.find(
          (row) =>
            row.id === input.cycleCountId &&
            (row.status ?? "draft") === "draft",
        );
        if (!count) throw new Error("Draft cycle count not found.");
        const created: StockChangeRequest[] = [];
        count.lines = count.lines.map((line) => {
          const product = this.data.products.find(
            (row) => row.id === line.productId,
          );
          if (!product) throw new Error(`Unknown product: ${line.productId}`);
          const expectedUnits = product.serialized
            ? this.data.units.filter(
                (unit) =>
                  unit.productId === product.id &&
                  unit.locationId === count.locationId &&
                  (unit.binId ?? undefined) === (count.binId ?? undefined) &&
                  ["in_stock", "returned"].includes(unit.status),
              )
            : [];
          if (product.serialized) {
            const serials = line.serialNumbers ?? [];
            if (new Set(serials).size !== serials.length) {
              throw new Error("Duplicate serial scan in cycle count.");
            }
            const expectedSerials = new Set(
              expectedUnits.map((unit) => unit.serialNumber),
            );
            if (serials.some((serial) => !expectedSerials.has(serial))) {
              throw new Error("Unknown serial scan in cycle count.");
            }
          }
          const expected = product.serialized
            ? expectedUnits.length
            : this.data.stockLevels
                .filter(
                  (level) =>
                    level.productId === product.id &&
                    level.locationId === count.locationId &&
                    (level.binId ?? undefined) === (count.binId ?? undefined),
                )
                .reduce((sum, level) => sum + level.quantity, 0);
          const counted = product.serialized
            ? (line.serialNumbers?.length ?? line.counted)
            : line.counted;
          const delta = counted - expected;
          if (delta !== 0) {
            const financialImpact = Math.abs(delta * product.unitCost);
            const request: StockChangeRequest = {
              id: this.newId("scr"),
              sourceType: "cycle_count",
              sourceId: count.id,
              productId: product.id,
              locationId: count.locationId,
              binId: count.binId,
              quantityDelta: delta,
              unitCost: product.unitCost,
              financialImpact,
              reason: input.reason,
              evidenceUrls: input.evidenceUrls ?? [],
              status: "pending_supervisor",
              requestedBy: count.requestedBy ?? count.actor,
              requestedAt: this.now(),
              canDecide: true,
            };
            this.stockChanges.push(request);
            created.push(request);
            this.exceptions.push({
              id: this.newId("ex"),
              type: "count_variance",
              severity: financialImpact > 10_000 ? "P1" : "P2",
              sourceType: "stock_change_request",
              sourceId: request.id,
              status: "open",
              createdAt: this.now(),
            });
          }
          return { ...line, expected, counted };
        });
        count.status = created.length ? "pending_approval" : "approved";
        count.requestedBy = count.requestedBy ?? count.actor;
        count.submittedAt = this.now();
        this.persist();
        return created;
      },
    );
  }

  async requestStockChange(
    input: RequestStockChangeInput,
    principal?: WarehouseControlPrincipal,
  ): Promise<StockChangeRequest> {
    return this.idempotent(
      "request_stock_change",
      input.idempotencyKey,
      { input, principal },
      () => {
        if (!principal?.capabilities.includes("manage_inventory")) {
          throw new Error("Not authorized: warehouse.manage_inventory.");
        }
        if (
          !Number.isInteger(input.quantityDelta) ||
          input.quantityDelta === 0
        ) {
          throw new Error(
            "Stock-change quantity must be a non-zero whole number.",
          );
        }
        if (!input.reason.trim())
          throw new Error("A stock-change reason is required.");
        const product = this.data.products.find(
          (row) => row.id === input.productId,
        );
        if (!product) throw new Error("Stock-change product not found.");
        const location = this.data.locations.find(
          (row) => row.id === input.locationId,
        );
        if (!location) throw new Error("Stock-change location not found.");
        if (
          input.binId &&
          !this.data.storageAreas.some(
            (row) =>
              row.id === input.binId && row.locationId === input.locationId,
          )
        ) {
          throw new Error(
            "Stock-change storage area does not belong to the location.",
          );
        }
        if (product.serialized) {
          throw new Error(
            "Serialized stock changes require identified cycle count evidence.",
          );
        }
        const requestId = this.newId("scr");
        const request: StockChangeRequest = {
          id: requestId,
          sourceType: input.sourceType,
          sourceId: requestId,
          productId: input.productId,
          locationId: input.locationId,
          binId: input.binId,
          quantityDelta: input.quantityDelta,
          unitCost: product.unitCost,
          financialImpact: Math.abs(input.quantityDelta * product.unitCost),
          reason: input.reason.trim(),
          evidenceUrls: input.evidenceUrls ?? [],
          status: "pending_supervisor",
          requestedBy: principal.actor,
          requestedAt: this.now(),
          canDecide: false,
        };
        this.stockChanges.push(request);
        this.exceptions.push({
          id: this.newId("ex"),
          type: "stock_variance",
          severity: request.financialImpact > 10_000 ? "P1" : "P2",
          sourceType: "stock_change_request",
          sourceId: request.id,
          status: "open",
          createdAt: this.now(),
        });
        this.persist();
        return request;
      },
    );
  }

  async decideStockChange(
    input: DecideStockChangeInput,
    principal?: WarehouseControlPrincipal,
  ): Promise<StockChangeRequest> {
    return this.idempotent(
      "decide_stock_change",
      input.idempotencyKey,
      { input, principal },
      () => {
        if (!principal)
          throw new Error("A trusted Warehouse principal is required.");
        const request = this.stockChanges.find(
          (row) => row.id === input.requestId,
        );
        if (
          !request ||
          !["pending_supervisor", "pending_finance"].includes(request.status)
        ) {
          throw new Error("Pending stock-change request not found.");
        }
        const currentStatus = request.status as
          "pending_supervisor" | "pending_finance";
        const requiredGroups =
          currentStatus === "pending_supervisor"
            ? ["warehouse_supervisor", "logistics_supervisor"]
            : ["finance"];
        if (
          !principal.approvalGroups.some((group) =>
            requiredGroups.includes(group),
          )
        ) {
          throw new Error(
            "The actor is not a member of the configured approval group for this step.",
          );
        }
        if (
          currentStatus === "pending_finance" &&
          request.supervisorApprovedBy === principal.actor
        ) {
          throw new Error(
            "Finance must be a distinct actor from the Warehouse Supervisor.",
          );
        }
        const nextStatus = stockChangeStatusAfterDecision({
          currentStatus,
          decision: input.decision,
          financialImpact: request.financialImpact,
          requestedBy: request.requestedBy,
          actor: principal.actor,
          principalCapabilities: principal.capabilities.filter(
            (capability) =>
              capability === "approve_stock_adjustment" ||
              capability === "approve_stock_adjustment_finance",
          ) as Array<
            "approve_stock_adjustment" | "approve_stock_adjustment_finance"
          >,
          note: input.note,
        });
        const count = this.data.cycleCounts.find(
          (row) => row.id === request.sourceId,
        );

        if (nextStatus === "approved") {
          const product = this.data.products.find(
            (row) => row.id === request.productId,
          );
          if (!product) throw new Error("Stock-change product not found.");
          if (product.serialized) {
            if (request.sourceType !== "cycle_count" || !count) {
              throw new Error(
                "Serialized stock changes require identified cycle count evidence.",
              );
            }
            const scanned =
              count.lines.find((line) => line.productId === product.id)
                ?.serialNumbers ?? [];
            const missing = this.data.units.filter(
              (unit) =>
                unit.productId === product.id &&
                unit.locationId === request.locationId &&
                (unit.binId ?? undefined) === (request.binId ?? undefined) &&
                unit.status === "in_stock" &&
                !scanned.includes(unit.serialNumber),
            );
            if (missing.length < Math.abs(request.quantityDelta)) {
              throw new Error(
                "Identified cycle count does not support the serialized variance.",
              );
            }
          } else {
            const level = this.stockRow(
              product.id,
              request.locationId,
              request.binId,
              false,
            );
            if ((level?.quantity ?? 0) + request.quantityDelta < 0) {
              throw new Error(
                "Stock cannot become negative due to insufficient stock.",
              );
            }
          }
        }

        request.status = nextStatus;
        if (
          currentStatus === "pending_supervisor" &&
          nextStatus === "pending_finance"
        ) {
          request.supervisorApprovedBy = principal.actor;
        }
        request.canDecide = ["pending_supervisor", "pending_finance"].includes(
          nextStatus,
        );
        if (nextStatus === "rejected") {
          if (count) count.status = "rejected";
        } else if (nextStatus === "approved") {
          const product = this.data.products.find(
            (row) => row.id === request.productId,
          )!;
          if (product.serialized) {
            const scanned =
              count?.lines.find((line) => line.productId === product.id)
                ?.serialNumbers ?? [];
            const missing = this.data.units.filter(
              (unit) =>
                unit.productId === product.id &&
                unit.locationId === request.locationId &&
                (unit.binId ?? undefined) === (request.binId ?? undefined) &&
                unit.status === "in_stock" &&
                !scanned.includes(unit.serialNumber),
            );
            for (const unit of missing.slice(
              0,
              Math.abs(request.quantityDelta),
            ))
              unit.status = "lost";
          } else {
            const level = this.stockRow(
              product.id,
              request.locationId,
              request.binId,
              true,
            )!;
            if (level.quantity + request.quantityDelta < 0)
              throw new Error("Stock cannot become negative.");
            level.quantity += request.quantityDelta;
          }
          this.data.movements.push({
            id: this.newId("mv"),
            type:
              request.sourceType === "cycle_count"
                ? "cycle_count"
                : "adjustment",
            productId: request.productId,
            quantity: request.quantityDelta,
            toLocationId: request.locationId,
            toBinId: request.binId,
            reason: request.reason,
            reference: request.id,
            evidenceUrls: request.evidenceUrls,
            actor: principal.actor,
            createdAt: this.now(),
          });
          const exception = this.exceptions.find(
            (row) =>
              row.sourceType === "stock_change_request" &&
              row.sourceId === request.id,
          );
          if (exception) {
            exception.status = "resolved";
            exception.resolution = input.note ?? "Approved stock change posted";
          }
          if (
            count &&
            !this.stockChanges.some(
              (row) => row.sourceId === count.id && row.status !== "approved",
            )
          )
            count.status = "approved";
        }
        this.persist();
        return request;
      },
    );
  }

  async resolveException(
    input: ResolveExceptionInput,
  ): Promise<WarehouseException> {
    return this.idempotent(
      "resolve_exception",
      input.idempotencyKey,
      input,
      () => {
        const exception = this.exceptions.find(
          (row) =>
            row.id === input.exceptionId &&
            ["open", "in_progress"].includes(row.status),
        );
        if (!exception) throw new Error("Active exception not found.");
        if (input.action === "assign") {
          if (!input.ownerId)
            throw new Error("An exception owner is required.");
          exception.ownerId = input.ownerId;
        } else if (input.action === "begin") {
          exception.status = "in_progress";
          exception.ownerId = input.ownerId ?? "demo-logistics-supervisor";
        } else {
          if (!input.resolution?.trim())
            throw new Error("Resolution text is required.");
          if (input.action === "waive" && exception.severity === "P1") {
            throw new Error("P1 exceptions cannot be waived.");
          }
          exception.status =
            input.action === "resolve"
              ? "resolved"
              : input.action === "waive"
                ? "waived"
                : "cancelled";
          exception.resolution = input.resolution;
        }
        return exception;
      },
    );
  }

  async createFulfillmentOrder(
    input: CreateFulfillmentOrderInput,
  ): Promise<FulfillmentOrder> {
    if (!input.externalReference.trim())
      throw new Error("Order reference is required.");
    if (input.lines.length === 0)
      throw new Error("At least one order line is required.");
    if (
      this.data.fulfillmentOrders.some(
        (order) =>
          order.externalReference.toLowerCase() ===
          input.externalReference.trim().toLowerCase(),
      )
    )
      throw new Error("Order reference already exists.");
    for (const line of input.lines) {
      if (line.quantity <= 0)
        throw new Error("Order quantities must be greater than zero.");
      const product = this.data.products.find(
        (product) => product.id === line.productId,
      );
      if (!product) {
        throw new Error(`Unknown product: ${line.productId}`);
      }
      const itemClass =
        product.itemClass ??
        (product.category === "device" ? "sellable_sku" : "merchandise");
      const eligibleClasses =
        input.source === "ecommerce"
          ? ["sellable_sku", "re_kitted_item"]
          : input.source === "department_request"
            ? ["sellable_sku", "merchandise"]
            : [
                "sellable_sku",
                "re_kitted_item",
                "merchandise",
                "event_material",
              ];
      if (!eligibleClasses.includes(itemClass)) {
        throw new Error(
          `${product.name} is not eligible for ${input.source} fulfillment.`,
        );
      }
    }
    if (input.source === "event" && !input.eventId) {
      throw new Error("An event is required for event fulfillment.");
    }
    if (input.source === "third_party") {
      if (!input.thirdPartyLocationId)
        throw new Error("A third-party location is required.");
      if (!input.eventId)
        throw new Error("An event is required for third-party sales.");
      if (input.grossSalesAmount === undefined || input.grossSalesAmount < 0) {
        throw new Error(
          "Gross sales amount is required for third-party sales.",
        );
      }
    }
    const createdAt = this.now();
    const created: FulfillmentOrder = {
      id: this.newId("fulfillment"),
      source: input.source,
      externalReference: input.externalReference.trim(),
      requestingDepartment: input.requestingDepartment?.trim() || undefined,
      customerReference: input.customerReference?.trim() || undefined,
      eventId: input.eventId,
      thirdPartyLocationId: input.thirdPartyLocationId,
      grossSalesAmount: input.grossSalesAmount,
      currency: input.grossSalesAmount === undefined ? undefined : "PHP",
      sourceLocationId: input.sourceLocationId,
      sourceBinId: input.sourceBinId,
      status: "received",
      lines: input.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        pickedQuantity: 0,
        pickedSerialNumbers: [],
        bundleSetCodes: line.bundleSetCodes,
      })),
      packaging: [],
      createdBy: input.actor,
      createdAt,
      updatedAt: createdAt,
    };
    this.data.fulfillmentOrders.push(created);
    this.persist();
    return clone(created);
  }

  async advanceFulfillmentOrder(
    input: AdvanceFulfillmentOrderInput,
  ): Promise<FulfillmentOrder> {
    const order = this.data.fulfillmentOrders.find(
      (row) => row.id === input.orderId,
    );
    if (!order) throw new Error("Fulfillment order not found.");
    const nextStatus = nextFulfillmentStatus(order.status, input.action);
    const sourceLocationId = order.sourceLocationId;

    if (input.action === "allocate") {
      for (const line of order.lines) {
        const product = this.data.products.find(
          (row) => row.id === line.productId,
        )!;
        const available = product.serialized
          ? this.data.units.filter(
              (unit) =>
                unit.productId === product.id &&
                unit.status === "in_stock" &&
                (!sourceLocationId || unit.locationId === sourceLocationId) &&
                (!order.sourceBinId || unit.binId === order.sourceBinId),
            ).length
          : this.data.stockLevels
              .filter(
                (level) =>
                  level.productId === product.id &&
                  (!sourceLocationId ||
                    level.locationId === sourceLocationId) &&
                  (!order.sourceBinId || level.binId === order.sourceBinId),
              )
              .reduce((sum, level) => sum + level.quantity, 0);
        if (available < line.quantity) {
          throw new Error(
            `Only ${available} of ${product.name} is available for this order.`,
          );
        }
      }
    }

    if (input.action === "confirm_pick") {
      const picked = input.pickedLines ?? [];
      for (const line of order.lines) {
        const selection = picked.find(
          (row) => row.productId === line.productId,
        );
        if (!selection || selection.quantity !== line.quantity) {
          throw new Error("Every order line must be picked in full.");
        }
        const product = this.data.products.find(
          (row) => row.id === line.productId,
        )!;
        const serialNumbers = selection.serialNumbers ?? [];
        if (product.serialized && serialNumbers.length !== line.quantity) {
          throw new Error(`${product.name} requires one serial scan per unit.`);
        }
        if (new Set(serialNumbers).size !== serialNumbers.length) {
          throw new Error("A serial number cannot be scanned twice.");
        }
        for (const serialNumber of serialNumbers) {
          const unit = this.data.units.find(
            (row) =>
              row.productId === product.id &&
              row.serialNumber === serialNumber &&
              row.status === "in_stock" &&
              (!sourceLocationId || row.locationId === sourceLocationId) &&
              (!order.sourceBinId || row.binId === order.sourceBinId),
          );
          if (!unit)
            throw new Error(
              `Serial ${serialNumber} is not available at the pick location.`,
            );
        }
        line.pickedQuantity = selection.quantity;
        line.pickedSerialNumbers = serialNumbers;
      }
    }

    if (input.action === "confirm_pack") {
      if (!input.courier?.trim())
        throw new Error("Courier is required at packing.");
      if (!input.waybillNumber?.trim())
        throw new Error("Waybill number is required at packing.");
      for (const material of input.packaging ?? []) {
        if (material.quantity <= 0)
          throw new Error("Packaging quantity must be greater than zero.");
        const product = this.data.products.find(
          (row) => row.id === material.productId,
        );
        if (!product)
          throw new Error(`Unknown packaging product: ${material.productId}`);
        if (product.itemClass !== "fulfillment_supply") {
          throw new Error(
            `${product.name} is not configured as a fulfillment supply.`,
          );
        }
        const available = this.data.stockLevels
          .filter(
            (level) =>
              level.productId === material.productId &&
              (!sourceLocationId || level.locationId === sourceLocationId),
          )
          .reduce((sum, level) => sum + level.quantity, 0);
        if (available < material.quantity)
          throw new Error(`Insufficient ${product.name} for packing.`);
      }
      order.courier = input.courier.trim();
      order.waybillNumber = input.waybillNumber.trim();
      order.packaging = clone(input.packaging ?? []);
    }

    if (input.action === "release") {
      const release = canReleaseFulfillmentOrder(order);
      if (!release.ok) throw new Error(release.reason);
      const createdAt = this.now();
      for (const line of order.lines) {
        const product = this.data.products.find(
          (row) => row.id === line.productId,
        )!;
        if (product.serialized) {
          for (const serialNumber of line.pickedSerialNumbers) {
            const unit = this.data.units.find(
              (row) =>
                row.productId === product.id &&
                row.serialNumber === serialNumber &&
                row.status === "in_stock",
            );
            if (!unit)
              throw new Error(`Serial ${serialNumber} is no longer available.`);
            unit.status = "issued";
            unit.assignedTo = order.externalReference;
            this.data.movements.push({
              id: this.newId("mv"),
              type: "fulfillment_release",
              productId: product.id,
              quantity: 1,
              fromLocationId: unit.locationId,
              fromBinId: unit.binId,
              serialNumber,
              reference: order.id,
              actor: input.actor,
              createdAt,
            });
          }
        } else {
          let remaining = line.quantity;
          const levels = this.data.stockLevels.filter(
            (level) =>
              level.productId === product.id &&
              (!sourceLocationId || level.locationId === sourceLocationId) &&
              (!order.sourceBinId || level.binId === order.sourceBinId),
          );
          if (
            levels.reduce((sum, level) => sum + level.quantity, 0) < remaining
          ) {
            throw new Error(
              `${product.name} is no longer available in the required quantity.`,
            );
          }
          for (const level of levels) {
            const take = Math.min(level.quantity, remaining);
            level.quantity -= take;
            remaining -= take;
            if (take > 0)
              this.data.movements.push({
                id: this.newId("mv"),
                type: "fulfillment_release",
                productId: product.id,
                quantity: take,
                fromLocationId: level.locationId,
                fromBinId: level.binId,
                reference: order.id,
                actor: input.actor,
                createdAt,
              });
          }
        }
      }
      for (const material of order.packaging) {
        let remaining = material.quantity;
        const levels = this.data.stockLevels.filter(
          (level) =>
            level.productId === material.productId &&
            (!sourceLocationId || level.locationId === sourceLocationId),
        );
        if (
          levels.reduce((sum, level) => sum + level.quantity, 0) < remaining
        ) {
          throw new Error(
            "Packaging stock changed before release. Re-pack the order.",
          );
        }
        for (const level of levels) {
          const take = Math.min(level.quantity, remaining);
          level.quantity -= take;
          remaining -= take;
          if (take > 0)
            this.data.movements.push({
              id: this.newId("mv"),
              type: "packaging_consumption",
              productId: material.productId,
              quantity: take,
              fromLocationId: level.locationId,
              fromBinId: level.binId,
              reference: order.id,
              actor: input.actor,
              createdAt,
            });
        }
      }
      order.releasedBy = input.actor;
      order.releasedAt = createdAt;
    }

    order.status = nextStatus;
    order.updatedAt = this.now();
    this.persist();
    return clone(order);
  }

  async createDepartmentStockRequest(
    input: CreateDepartmentStockRequestInput,
  ): Promise<DepartmentStockRequest> {
    const errors = validateDepartmentRequest(input);
    if (errors.length > 0) throw new Error(errors.join(" "));
    const requestedProducts = input.lines.map((line) =>
      this.data.products.find((product) => product.id === line.productId),
    );
    if (requestedProducts.some((product) => !product)) {
      throw new Error("Every request line must identify an existing product.");
    }
    if (
      requestedProducts.some((product) => {
        const itemClass =
          product!.itemClass ??
          (product!.category === "device" ? "sellable_sku" : "merchandise");
        return !["sellable_sku", "merchandise"].includes(itemClass);
      })
    ) {
      throw new Error(
        "Department requests may include only sellable SKU and merchandise items.",
      );
    }
    if (
      requestedProducts.some(
        (product) =>
          (product!.itemClass ??
            (product!.category === "device"
              ? "sellable_sku"
              : "merchandise")) === "merchandise",
      ) &&
      input.expenseTreatment !== "expense"
    ) {
      throw new Error("All merchandise requests must use expense treatment.");
    }
    const request: DepartmentStockRequest = {
      id: this.newId("stock-request"),
      requestingDepartment: input.requestingDepartment.trim(),
      purpose: input.purpose.trim(),
      costCenter: input.costCenter.trim(),
      requiredDate: input.requiredDate,
      expenseTreatment: input.expenseTreatment,
      status: "pending_approval",
      lines: clone(input.lines),
      requestedBy: input.actor,
      requestedAt: this.now(),
    };
    this.data.departmentStockRequests.push(request);
    this.persist();
    return clone(request);
  }

  async decideDepartmentStockRequest(
    input: DecideDepartmentStockRequestInput,
  ): Promise<DepartmentStockRequest> {
    const request = this.data.departmentStockRequests.find(
      (row) => row.id === input.requestId,
    );
    if (!request || request.status !== "pending_approval") {
      throw new Error("Pending department request not found.");
    }
    if (request.requestedBy === input.actor)
      throw new Error("Requester cannot approve their own request.");
    request.status = input.decision;
    request.approvedBy = input.actor;
    request.approvedAt = this.now();
    if (input.decision === "approved") {
      const order = await this.createFulfillmentOrder({
        source: "department_request",
        externalReference: `REQ-${request.id}`,
        requestingDepartment: request.requestingDepartment,
        lines: request.lines,
        actor: input.actor,
      });
      request.fulfillmentOrderId = order.id;
    }
    this.persist();
    return clone(request);
  }

  async createCustomerReturnCase(
    input: CreateCustomerReturnCaseInput,
  ): Promise<CustomerReturnCase> {
    const product = this.data.products.find(
      (row) => row.id === input.productId,
    );
    if (!product) throw new Error("Product not found.");
    if (!input.defectDescription.trim())
      throw new Error("Defect description is required.");
    if (product.serialized && !input.serialNumber?.trim()) {
      throw new Error("Serial number is required for this product.");
    }
    if (
      input.serialNumber &&
      !this.data.units.some(
        (unit) =>
          unit.productId === product.id &&
          unit.serialNumber === input.serialNumber,
      )
    ) {
      throw new Error("Serial number is not recognized for this product.");
    }
    const created: CustomerReturnCase = {
      id: this.newId("return-case"),
      sourceOrderId: input.sourceOrderId,
      serialNumber: input.serialNumber?.trim(),
      productId: input.productId,
      defectDescription: input.defectDescription.trim(),
      requestingDepartment: "customer_service",
      status: "submitted",
      resolution: "pending",
      createdBy: input.actor,
      createdAt: this.now(),
    };
    this.data.customerReturnCases.push(created);
    this.persist();
    return clone(created);
  }

  async resolveCustomerReturnCase(
    input: ResolveCustomerReturnCaseInput,
  ): Promise<CustomerReturnCase> {
    const record = this.data.customerReturnCases.find(
      (row) => row.id === input.returnCaseId,
    );
    if (!record || record.status === "resolved")
      throw new Error("Open return case not found.");
    if (
      ["replacement", "refund", "re_kit"].includes(input.resolution) &&
      !input.quarantineBinId
    ) {
      throw new Error("A quarantine bin is required before resolution.");
    }
    if (input.resolution === "refund" && !input.refundReference?.trim()) {
      throw new Error("Finance refund reference is required.");
    }
    record.status = "resolved";
    record.resolution = input.resolution;
    record.quarantineBinId = input.quarantineBinId;
    record.replacementOrderId = input.replacementOrderId;
    record.refundReference = input.refundReference?.trim();
    record.supplierReference = input.supplierReference?.trim();
    record.resolvedBy = input.actor;
    record.resolvedAt = this.now();
    if (record.serialNumber && input.quarantineBinId) {
      const bin = this.data.storageAreas.find(
        (row) => row.id === input.quarantineBinId && row.active,
      );
      if (!bin) throw new Error("Active quarantine bin not found.");
      const unit = this.data.units.find(
        (row) =>
          row.productId === record.productId &&
          row.serialNumber === record.serialNumber,
      );
      if (!unit) throw new Error("Returned serial is no longer recognized.");
      unit.status = "returned";
      unit.locationId = bin.locationId;
      unit.binId = bin.id;
      unit.assignedTo = undefined;
      this.data.movements.push({
        id: this.newId("mv"),
        type: "return",
        productId: record.productId,
        quantity: 1,
        toLocationId: bin.locationId,
        toBinId: bin.id,
        serialNumber: record.serialNumber,
        reason: input.resolution,
        reference: record.id,
        actor: input.actor,
        createdAt: record.resolvedAt,
      });
    }
    this.persist();
    return clone(record);
  }

  async createKitDefinition(
    input: CreateKitDefinitionInput,
  ): Promise<KitDefinition> {
    if (input.ownerDepartment !== "product") {
      throw new Error("Only the Product department can own a kit definition.");
    }
    if (!input.productApprovalReference.trim()) {
      throw new Error(
        "Product approval reference is required before a kit definition can be published.",
      );
    }
    if (!this.data.products.some((product) => product.id === input.productId)) {
      throw new Error("Kit product not found.");
    }
    if (!input.name.trim() || input.components.length === 0) {
      throw new Error("Kit name and components are required.");
    }
    const version =
      Math.max(
        0,
        ...this.data.kitDefinitions
          .filter((row) => row.productId === input.productId)
          .map((row) => row.version),
      ) + 1;
    const created: KitDefinition = {
      id: this.newId("kit"),
      productId: input.productId,
      version,
      name: input.name.trim(),
      components: clone(input.components),
      status: input.status,
      ownerDepartment: "product",
      productApprovalReference: input.productApprovalReference.trim(),
      createdBy: input.actor,
      createdAt: this.now(),
    };
    this.data.kitDefinitions.push(created);
    this.persist();
    return clone(created);
  }

  async createReKitWorkOrder(
    input: CreateReKitWorkOrderInput,
  ): Promise<ReKitWorkOrder> {
    const returnCase = this.data.customerReturnCases.find(
      (row) => row.id === input.sourceReturnCaseId,
    );
    if (!returnCase || returnCase.resolution !== "re_kit") {
      throw new Error("A return case resolved for re-kitting is required.");
    }
    const definition = this.data.kitDefinitions.find(
      (row) => row.id === input.kitDefinitionId && row.status === "active",
    );
    if (!definition) throw new Error("An active kit definition is required.");
    if (!input.outputSerialNumber.trim())
      throw new Error("Output serial number is required.");
    if (
      new Set(input.componentSerialNumbers).size !==
      input.componentSerialNumbers.length
    ) {
      throw new Error("Component serial numbers must be unique.");
    }
    for (const component of definition.components.filter((row) =>
      ["required", "asset_tag"].includes(row.serializationPolicy),
    )) {
      const found = this.data.units.filter(
        (unit) =>
          unit.productId === component.productId &&
          ["in_stock", "returned"].includes(unit.status) &&
          input.componentSerialNumbers.includes(unit.serialNumber),
      ).length;
      if (found !== component.quantity) {
        throw new Error(
          `Re-kit requires ${component.quantity} serialized component(s) for product ${component.productId}.`,
        );
      }
    }
    const created: ReKitWorkOrder = {
      id: this.newId("rekit"),
      sourceReturnCaseId: input.sourceReturnCaseId,
      kitDefinitionId: input.kitDefinitionId,
      outputSerialNumber: input.outputSerialNumber.trim(),
      componentSerialNumbers: [...input.componentSerialNumbers],
      condition: input.condition,
      status: "inspection",
      createdBy: input.actor,
      createdAt: this.now(),
    };
    this.data.reKitWorkOrders.push(created);
    this.persist();
    return clone(created);
  }

  async completeReKitWorkOrder(
    input: CompleteReKitWorkOrderInput,
  ): Promise<ReKitWorkOrder> {
    const work = this.data.reKitWorkOrders.find(
      (row) => row.id === input.workOrderId,
    );
    if (!work || !["inspection", "ready"].includes(work.status)) {
      throw new Error("Inspected re-kit work order not found.");
    }
    const definition = this.data.kitDefinitions.find(
      (row) => row.id === work.kitDefinitionId && row.status === "active",
    );
    if (!definition)
      throw new Error("The active kit definition is no longer available.");
    const outputProduct = this.data.products.find(
      (row) => row.id === definition.productId,
    );
    if (!outputProduct?.serialized) {
      throw new Error("Re-kit output must be a serialized product.");
    }
    const location = this.data.locations.find(
      (row) => row.id === input.locationId,
    );
    const bin = this.data.storageAreas.find(
      (row) =>
        row.id === input.binId &&
        row.locationId === input.locationId &&
        row.active,
    );
    if (!location || !bin)
      throw new Error("An active output warehouse bin is required.");
    if (
      this.data.units.some(
        (unit) => unit.serialNumber === work.outputSerialNumber,
      )
    ) {
      throw new Error("Output serial number already exists.");
    }
    const completedAt = this.now();
    for (const componentSerial of work.componentSerialNumbers) {
      const component = this.data.units.find(
        (unit) => unit.serialNumber === componentSerial,
      );
      if (component) {
        component.status = "issued";
        component.assignedTo = `rekit:${work.id}`;
      }
    }
    this.data.units.push({
      id: this.newId("unit"),
      productId: outputProduct.id,
      serialNumber: work.outputSerialNumber,
      locationId: input.locationId,
      binId: input.binId,
      status: "in_stock",
    });
    this.data.movements.push({
      id: this.newId("mv"),
      type: "re_kit",
      productId: outputProduct.id,
      quantity: 1,
      toLocationId: input.locationId,
      toBinId: input.binId,
      serialNumber: work.outputSerialNumber,
      reason: `${work.condition} assembly completed`,
      reference: work.id,
      actor: input.actor,
      createdAt: completedAt,
    });
    work.status = "completed";
    work.completedBy = input.actor;
    work.completedAt = completedAt;
    this.persist();
    return clone(work);
  }

  async getReceivableProcurementPOs(): Promise<ProcurementPOHandoff[]> {
    return this.data.purchaseOrders
      .filter((po) => ["ordered", "partially_received"].includes(po.status))
      .map((po) => ({
        id: po.id,
        poNumber: po.id,
        vendorName:
          this.data.suppliers.find((supplier) => supplier.id === po.supplierId)
            ?.name ?? po.supplierId,
        status: "issued" as const,
        expectedDate: po.expectedDate,
        lines: po.lines.map((line, index) => ({
          id: `${po.id}-${index}`,
          description:
            this.data.products.find((product) => product.id === line.productId)
              ?.name ?? line.productId,
          quantity: line.quantityOrdered,
          receivedQuantity: line.quantityReceived,
        })),
      }));
  }

  async receiveProcurementPO(
    input: ReceiveProcurementPOInput,
  ): Promise<Receipt> {
    return this.receiveStock({
      locationId: input.locationId,
      lines: input.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        lotCode: line.lotCode,
        serialNumbers: line.serialNumbers,
        binId: input.binId,
      })),
      evidenceUrls: input.evidenceUrls,
      actor: "demo-procurement-receiver",
    });
  }
}
