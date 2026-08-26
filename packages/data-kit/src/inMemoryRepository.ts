import type {
  Allocation,
  CycleCount,
  Location,
  Lot,
  Movement,
  PurchaseOrder,
  Receipt,
  ReturnDisposition,
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
  type CloseCustomerReturnCaseInput,
  type CreateLocationInput,
  type CreateAndSubmitCycleCountInput,
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
  deliveryMethodForSource,
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
  type QualityDisposition,
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

function normalizeSerialIdentity(serialNumber: string): string {
  return serialNumber.trim().toUpperCase();
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
  private procurementReceiptSerialClaims = new Map<
    string,
    { receiptId: string; outcome: "damaged" | "unidentified" | "excess" }
  >();
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
      fulfillmentOrders: (source.fulfillmentOrders ?? []).map((order) => ({
        ...order,
        shipmentEvents: order.shipmentEvents ?? [],
        deliveryMethod:
          order.deliveryMethod ?? deliveryMethodForSource(order.source),
      })),
      fulfillmentReservations: source.fulfillmentReservations ?? [],
      departmentRequestOptions:
        source.departmentRequestOptions ?? buildSeed().departmentRequestOptions,
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

  private syncDepartmentRequest(order: FulfillmentOrder): void {
    const request = this.data.departmentStockRequests.find(
      (row) => row.fulfillmentOrderId === order.id,
    );
    if (!request) return;
    request.status =
      order.status === "cancelled"
        ? "cancelled"
        : order.status === "completed"
          ? "closed"
          : order.status === "released"
            ? "issued"
            : ["allocated", "picking", "packing", "ready"].includes(
                  order.status,
                )
              ? "allocated"
              : "approved";
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
    this.assertDirectReceiptException(input);
    const idempotencyKey = input.idempotencyKey;
    if (idempotencyKey) {
      if (!/^[A-Za-z0-9_-]{12,128}$/.test(idempotencyKey)) {
        throw new Error("A valid idempotency key is required.");
      }
      const receiptId = `rcpt-${idempotencyKey}`;
      const existing = this.data.receipts.find(
        (receipt) => receipt.id === receiptId,
      );
      if (existing) {
        this.assertReceiveReplayMatches(existing, input);
        return clone(existing);
      }
      return this.idempotent(
        "receive_stock",
        idempotencyKey,
        this.receiveReplayPayload(input),
        () => this.receiveStockOnce(input, idempotencyKey),
      );
    }
    return this.receiveStockOnce(input);
  }

  private receiveStockOnce(
    input: ReceiveStockInput,
    idempotencyKey?: string,
  ): Receipt {
    const createdAt = this.now();
    const receipt: Receipt = {
      id: idempotencyKey ? `rcpt-${idempotencyKey}` : this.newId("rcpt"),
      supplierId: input.supplierId,
      actualDeliveryDate: input.actualDeliveryDate,
      deliveryReference: input.deliveryReference,
      courierOrDriver: input.courierOrDriver,
      locationId: input.locationId,
      lines: input.lines,
      evidenceUrls: input.evidenceUrls,
      receiptException: input.receiptException,
      qualityStatus: "pending",
      actor: input.actor,
      createdAt,
    };

    for (const [lineIndex, line] of input.lines.entries()) {
      const product = this.data.products.find((p) => p.id === line.productId);
      if (!product) throw new Error(`Unknown product: ${line.productId}`);

      // Capture a lot whenever a unit cost or lot code is supplied so receipts
      // feed landed-cost / pricing analytics.
      let lotId: string | undefined;
      if (line.unitCost != null || line.lotCode || line.expiryDate) {
        const lot: Lot = {
          id: idempotencyKey
            ? `lot-${idempotencyKey}-${lineIndex}`
            : this.newId("lot"),
          productId: product.id,
          lotCode:
            line.lotCode ??
            (idempotencyKey
              ? `LOT-${product.sku}-${idempotencyKey}-${lineIndex}`
              : `LOT-${product.sku}-${Date.now()}`),
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
            : Array.from({ length: line.quantity }, (_, i) =>
                idempotencyKey
                  ? `${product.sku}-SN-${idempotencyKey}-${i}`
                  : `${product.sku}-SN${Date.now()}${i}`,
              );
        for (const [serialIndex, serialNumber] of serials.entries()) {
          this.data.units.push({
            id: idempotencyKey
              ? `unit-${idempotencyKey}-${lineIndex}-${serialIndex}`
              : this.newId("unit"),
            productId: product.id,
            serialNumber,
            lotId,
            locationId: input.locationId,
            binId: line.binId,
            status: "pending_inspection",
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
        level.unavailable = (level.unavailable ?? 0) + line.quantity;
      }

      this.data.movements.push({
        id: idempotencyKey
          ? `mv-${idempotencyKey}-${lineIndex}`
          : this.newId("mv"),
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

  private receiveReplayPayload(input: ReceiveStockInput): string {
    return JSON.stringify({
      supplierId: input.supplierId ?? null,
      actualDeliveryDate: input.actualDeliveryDate ?? null,
      deliveryReference: input.deliveryReference ?? null,
      courierOrDriver: input.courierOrDriver ?? null,
      locationId: input.locationId,
      lines: input.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        lotCode: line.lotCode ?? null,
        batchNumber: line.batchNumber ?? null,
        deviceTestStatus: line.deviceTestStatus ?? null,
        expiryDate: line.expiryDate ?? null,
        serialNumbers: line.serialNumbers ?? [],
        unitCost: line.unitCost ?? null,
        binId: line.binId ?? null,
      })),
      evidenceUrls: input.evidenceUrls ?? [],
      receiptException: input.receiptException ?? null,
    });
  }

  private assertReceiveReplayMatches(
    receipt: Receipt,
    input: ReceiveStockInput,
  ): void {
    const receiptPayload = JSON.stringify({
      supplierId: receipt.supplierId ?? null,
      actualDeliveryDate: receipt.actualDeliveryDate ?? null,
      deliveryReference: receipt.deliveryReference ?? null,
      courierOrDriver: receipt.courierOrDriver ?? null,
      locationId: receipt.locationId,
      lines: receipt.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        lotCode: line.lotCode ?? null,
        batchNumber: line.batchNumber ?? null,
        deviceTestStatus: line.deviceTestStatus ?? null,
        expiryDate: line.expiryDate ?? null,
        serialNumbers: line.serialNumbers ?? [],
        unitCost: line.unitCost ?? null,
        binId: line.binId ?? null,
      })),
      evidenceUrls: receipt.evidenceUrls ?? [],
      receiptException: receipt.receiptException ?? null,
    });
    if (receiptPayload !== this.receiveReplayPayload(input)) {
      throw new Error("Idempotency key was reused with a different payload.");
    }
  }

  private assertDirectReceiptException(input: ReceiveStockInput): void {
    const exception = input.receiptException;
    if (!exception?.reason.trim() || exception.evidenceUrls.length === 0) {
      throw new Error(
        "An approved purchase order or an evidenced receiving exception is required.",
      );
    }
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
    if (
      input.lines.some(
        (line) => line.disposition && line.disposition !== "quarantine",
      )
    ) {
      throw new Error(
        "Return intake is quarantine-first; Quality controls final disposition.",
      );
    }
    if (input.lines.some((line) => !line.locationId)) {
      throw new Error(
        "A quarantine location is required for every returned line.",
      );
    }
    const createdAt = this.now();
    const quarantinedLines = input.lines.map((line) => ({
      ...line,
      disposition: "quarantine" as const,
    }));
    const record: ReturnRecord = {
      id: uid("ret"),
      source: input.source,
      eventId: input.eventId,
      lines: quarantinedLines,
      evidenceUrls: input.evidenceUrls,
      actor: input.actor,
      createdAt,
    };

    for (const line of quarantinedLines) {
      const product = this.data.products.find((p) => p.id === line.productId);
      if (!product) throw new Error(`Unknown product: ${line.productId}`);

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
        unit.status = "pending_inspection";
        unit.assignedTo = undefined;
        unit.locationId = line.locationId!;
        if (line.binId !== undefined) unit.binId = line.binId;
      } else if (!product.serialized) {
        const level = this.stockRow(
          product.id,
          line.locationId!,
          line.binId,
          true,
        )!;
        level.quantity += line.quantity;
        level.unavailable = (level.unavailable ?? 0) + line.quantity;
      }

      this.data.movements.push({
        id: uid("mv"),
        type: "return",
        productId: product.id,
        quantity: line.quantity,
        toLocationId: line.locationId,
        toBinId: line.binId,
        eventId: input.eventId,
        reason: `${line.reason} (quarantine)`,
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
      const remaining = poLine.quantityOrdered - poLine.quantityReceived;
      if (line.quantityReceived > remaining) {
        throw new Error(
          "PO overage must be recorded as an evidenced receiving exception.",
        );
      }
      poLine.quantityReceived += line.quantityReceived;
    }

    const receipt = this.receiveStockOnce({
      supplierId: po.supplierId,
      locationId: input.locationId,
      lines: input.lines
        .filter((line) => line.quantityReceived > 0)
        .map((line) => ({
          productId: line.productId,
          quantity: line.quantityReceived,
          binId: input.binId,
        })),
      actor: input.actor,
    });
    const storedReceipt = this.data.receipts.find(
      (row) => row.id === receipt.id,
    )!;
    storedReceipt.procurementPoId = po.id;

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
    const nextActive = input.active ?? location.active ?? true;
    const invalidatesExternalCustody =
      input.type !== location.type ||
      ((location.active ?? true) && !nextActive);
    const hasNonterminalThirdPartyCustody =
      invalidatesExternalCustody &&
      this.data.fulfillmentOrders.some(
        (order) =>
          order.source === "third_party" &&
          order.thirdPartyLocationId === location.id &&
          !["completed", "cancelled"].includes(order.status),
      );
    if (hasNonterminalThirdPartyCustody) {
      throw new Error(
        "Cannot deactivate or reclassify a location with nonterminal third-party fulfillment custody.",
      );
    }
    location.name = input.name.trim();
    location.type = input.type;
    if (input.active !== undefined) location.active = input.active;
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
      ...this.data.receipts
        .filter((receipt) =>
          ["pending", "partial"].includes(receipt.qualityStatus ?? "pending"),
        )
        .map((receipt) => ({
          id: `quality-receipt-${receipt.id}`,
          type: "quality" as const,
          sourceId: receipt.id,
          title: `Inspect receipt ${receipt.id}`,
          status: "due" as const,
        })),
      ...this.data.returns
        .filter((returned) =>
          returned.lines.some((line) => line.disposition === "quarantine"),
        )
        .map((returned) => ({
          id: `quality-return-${returned.id}`,
          type: "quality" as const,
          sourceId: returned.id,
          title: `Inspect return ${returned.id}`,
          status: "due" as const,
        })),
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
      const row = position(level.productId, level.locationId, level.binId);
      row.onHand += level.quantity;
      row.unavailable += level.unavailable ?? 0;
    }
    for (const unit of this.data.units) {
      if (unit.status === "in_stock") {
        position(unit.productId, unit.locationId, unit.binId).onHand += 1;
      } else if (
        unit.status === "returned" ||
        unit.status === "pending_inspection"
      ) {
        const row = position(unit.productId, unit.locationId, unit.binId);
        row.onHand += 1;
        const coveredByHold = this.holds.some(
          (hold) =>
            hold.status === "active" &&
            hold.productId === unit.productId &&
            hold.locationId === unit.locationId &&
            (hold.binId ?? undefined) === (unit.binId ?? undefined) &&
            (hold.serialNumber === undefined ||
              hold.serialNumber === unit.serialNumber),
        );
        if (!coveredByHold) row.unavailable += 1;
      }
    }
    for (const hold of this.holds.filter((row) => row.status === "active")) {
      const row = position(hold.productId, hold.locationId, hold.binId);
      row.held += hold.quantity;
      row.unavailable = Math.max(0, row.unavailable - hold.quantity);
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

  private pendingInspectionUnits(
    input: Pick<InspectQualityInput, "productId" | "serialNumber">,
    locationId: string,
    binId?: string,
  ) {
    return this.data.units.filter(
      (unit) =>
        unit.productId === input.productId &&
        unit.locationId === locationId &&
        unit.status === "pending_inspection" &&
        (input.serialNumber === undefined ||
          unit.serialNumber === input.serialNumber) &&
        (binId === undefined || unit.binId === binId),
    );
  }

  private returnDispositionForQuality(
    disposition: Exclude<QualityDisposition, "pending">,
  ): ReturnDisposition {
    if (disposition === "accepted") return "restock";
    if (disposition === "vendor_return") return "vendor_return";
    if (disposition === "unavailable") return "lost";
    return "hold";
  }

  private resolveReturnLines(
    returned: ReturnRecord,
    input: Pick<
      InspectQualityInput,
      "productId" | "serialNumber" | "binId" | "quantity"
    >,
    disposition: ReturnDisposition,
    currentDisposition: ReturnDisposition = "quarantine",
  ): void {
    const matches = (line: ReturnRecord["lines"][number]) =>
      line.productId === input.productId &&
      line.disposition === currentDisposition &&
      (input.serialNumber === undefined ||
        line.serialNumber === input.serialNumber) &&
      (input.binId === undefined || line.binId === input.binId);
    const available = returned.lines
      .filter(matches)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (available < input.quantity) {
      throw new Error("Pending return line is not available for inspection.");
    }

    let remaining = input.quantity;
    for (
      let index = 0;
      index < returned.lines.length && remaining > 0;
      index += 1
    ) {
      const line = returned.lines[index]!;
      if (!matches(line)) continue;
      const resolvedQuantity = Math.min(line.quantity, remaining);
      if (resolvedQuantity < line.quantity) {
        returned.lines.splice(index + 1, 0, {
          ...line,
          quantity: line.quantity - resolvedQuantity,
        });
        line.quantity = resolvedQuantity;
        index += 1;
      }
      line.disposition = disposition;
      remaining -= resolvedQuantity;
    }
  }

  private releaseInspectedStock(
    inspection: QualityInspection,
    hold: InventoryHold,
  ): void {
    const product = this.data.products.find(
      (row) => row.id === inspection.productId,
    );
    if (!product) throw new Error("Inspection product not found.");

    if (product.serialized) {
      const candidates = this.data.units.filter(
        (unit) =>
          unit.productId === hold.productId &&
          unit.locationId === hold.locationId &&
          ["pending_inspection", "returned"].includes(unit.status) &&
          (hold.serialNumber === undefined ||
            unit.serialNumber === hold.serialNumber) &&
          (hold.binId === undefined || unit.binId === hold.binId),
      );
      if (candidates.length < hold.quantity) {
        throw new Error("Held serialized stock is not available for release.");
      }
      for (const unit of candidates.slice(0, hold.quantity)) {
        unit.status = "in_stock";
      }
    } else {
      const level = this.stockRow(
        hold.productId,
        hold.locationId,
        hold.binId,
        false,
      );
      if (!level || level.quantity < hold.quantity) {
        throw new Error("Held stock is not available for release.");
      }
      level.unavailable = Math.max(0, (level.unavailable ?? 0) - hold.quantity);
    }

    if (inspection.sourceType === "return") {
      const returned = this.data.returns.find(
        (row) => row.id === inspection.sourceId,
      );
      if (!returned) throw new Error("Return source not found.");
      this.resolveReturnLines(
        returned,
        {
          productId: hold.productId,
          serialNumber: hold.serialNumber,
          binId: hold.binId,
          quantity: hold.quantity,
        },
        "restock",
        "hold",
      );
    } else {
      const receipt = this.data.receipts.find(
        (row) => row.id === inspection.sourceId,
      );
      if (receipt) receipt.qualityStatus = "accepted";
    }
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
        const alreadyInspected = this.qualityInspections
          .filter(
            (inspection) =>
              inspection.sourceType === input.sourceType &&
              inspection.sourceId === input.sourceId &&
              inspection.productId === input.productId,
          )
          .reduce((sum, inspection) => sum + inspection.quantity, 0);
        if (
          input.quantity <= 0 ||
          input.quantity > sourceQuantity - alreadyInspected
        ) {
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
        const product = this.data.products.find(
          (row) => row.id === input.productId,
        );
        if (!product) throw new Error("Inspection product not found.");
        const sourceBinId =
          input.binId ??
          receipt?.lines.find((line) => line.productId === input.productId)
            ?.binId ??
          returned?.lines.find((line) => line.productId === input.productId)
            ?.binId;
        const returnDisposition = returned
          ? this.returnDispositionForQuality(input.disposition)
          : undefined;
        if (input.disposition === "accepted") {
          if (product.serialized) {
            const candidates = this.data.units.filter(
              (unit) =>
                unit.productId === input.productId &&
                unit.locationId === locationId &&
                unit.status === "pending_inspection" &&
                (input.serialNumber === undefined ||
                  unit.serialNumber === input.serialNumber) &&
                (sourceBinId === undefined || unit.binId === sourceBinId),
            );
            if (candidates.length < input.quantity) {
              throw new Error(
                "Pending serialized stock is not available for inspection.",
              );
            }
            for (const unit of candidates.slice(0, input.quantity)) {
              unit.status = "in_stock";
            }
          } else {
            const level = this.stockRow(
              input.productId,
              locationId,
              sourceBinId,
              false,
            );
            if (!level || (level.unavailable ?? 0) < input.quantity) {
              throw new Error("Pending stock is not available for inspection.");
            }
            level.unavailable = (level.unavailable ?? 0) - input.quantity;
          }
        } else if (returned && input.disposition === "unavailable") {
          if (product.serialized) {
            const candidates = this.pendingInspectionUnits(
              input,
              locationId,
              sourceBinId,
            );
            if (candidates.length < input.quantity) {
              throw new Error(
                "Pending serialized stock is not available for inspection.",
              );
            }
            for (const unit of candidates.slice(0, input.quantity)) {
              unit.status = "lost";
            }
          } else {
            const level = this.stockRow(
              input.productId,
              locationId,
              sourceBinId,
              false,
            );
            if (
              !level ||
              level.quantity < input.quantity ||
              (level.unavailable ?? 0) < input.quantity
            ) {
              throw new Error("Pending stock is not available for inspection.");
            }
            level.quantity -= input.quantity;
            level.unavailable = (level.unavailable ?? 0) - input.quantity;
          }
        } else if (!(returned && input.disposition === "unavailable")) {
          if (product.serialized) {
            const candidates = this.pendingInspectionUnits(
              input,
              locationId,
              sourceBinId,
            );
            if (candidates.length < input.quantity) {
              throw new Error(
                "Pending serialized stock is not available for inspection.",
              );
            }
            for (const unit of candidates.slice(0, input.quantity)) {
              unit.status = "returned";
            }
          } else {
            const level = this.stockRow(
              input.productId,
              locationId,
              sourceBinId,
              false,
            );
            if (!level || level.quantity < input.quantity) {
              throw new Error("Pending stock is not available for inspection.");
            }
          }
        }
        if (returned && returnDisposition) {
          this.resolveReturnLines(returned, input, returnDisposition);
        }
        if (receipt) {
          const inspected = this.qualityInspections
            .filter(
              (row) =>
                row.sourceType === "receipt" && row.sourceId === receipt.id,
            )
            .reduce((sum, row) => sum + row.quantity, input.quantity);
          const received = receipt.lines.reduce(
            (sum, line) => sum + line.quantity,
            0,
          );
          receipt.qualityStatus =
            inspected >= received
              ? input.disposition === "accepted"
                ? "accepted"
                : "hold"
              : "partial";
        }
        this.qualityInspections.push(inspection);
        if (
          input.disposition !== "accepted" &&
          !(returned && input.disposition === "unavailable")
        ) {
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
      if (inspection) {
        this.releaseInspectedStock(inspection, hold);
        inspection.disposition = "accepted";
      }
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
              ["in_stock", "pending_inspection", "returned"].includes(
                row.status,
              ),
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
          level.unavailable = Math.max(
            0,
            (level.unavailable ?? 0) - hold.quantity,
          );
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

  async createAndSubmitCycleCount(
    input: CreateAndSubmitCycleCountInput,
  ): Promise<StockChangeRequest[]> {
    if (input.evidenceUrls.length === 0) {
      throw new Error("Cycle-count evidence is required.");
    }
    if (!/^[A-Za-z0-9_-]{12,128}$/.test(input.idempotencyKey)) {
      throw new Error("A valid idempotency key is required.");
    }
    const cacheKey = `create_and_submit_cycle_count:${input.idempotencyKey}`;
    const payload = JSON.stringify(input);
    const existing = this.commandResponses.get(cacheKey);
    if (existing) {
      if (existing.payload !== payload) {
        throw new Error("Idempotency key was reused with a different payload.");
      }
      return clone(existing.response as StockChangeRequest[]);
    }

    const dataBefore = clone(this.data);
    const stockChangesBefore = clone(this.stockChanges);
    const exceptionsBefore = clone(this.exceptions);
    let nestedKey = "";
    try {
      const count: CycleCount = {
        id: this.newId("cc"),
        locationId: input.locationId,
        binId: input.binId,
        category: input.category,
        lines: clone(input.lines),
        status: "draft",
        requestedBy: input.requesterId ?? input.actor,
        actor: input.actor,
        createdAt: this.now(),
      };
      this.data.cycleCounts.push(count);
      nestedKey = `atomic-${count.id}`;
      const response = await this.submitCycleCount({
        idempotencyKey: nestedKey,
        cycleCountId: count.id,
        reason: input.reason,
        evidenceUrls: input.evidenceUrls,
      });
      this.commandResponses.set(cacheKey, {
        payload,
        response: clone(response),
      });
      return clone(response);
    } catch (error) {
      this.data = dataBefore;
      this.stockChanges = stockChangesBefore;
      this.exceptions = exceptionsBefore;
      if (nestedKey) {
        this.commandResponses.delete(`submit_cycle_count:${nestedKey}`);
      }
      this.persist();
      throw error;
    }
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
            ? ["sellable_sku", "merchandise", "event_material"]
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
    const controlledEcommerceIntake =
      input.source === "ecommerce" &&
      Boolean(
        input.ecommerceChannel?.trim() ||
        input.customerName?.trim() ||
        input.deliveryAddress ||
        input.paymentStatus ||
        input.requestingDepartment === "sales_ecommerce",
      );
    if (controlledEcommerceIntake) {
      if (!input.ecommerceChannel?.trim())
        throw new Error("Ecommerce channel is required.");
      if (!input.customerName?.trim() || !input.customerContact?.trim())
        throw new Error("Customer name and contact are required.");
      if (
        !input.deliveryAddress?.addressLine.trim() ||
        !input.deliveryAddress.city.trim() ||
        !input.deliveryAddress.province.trim() ||
        !input.deliveryAddress.postalCode.trim()
      )
        throw new Error("A complete delivery address is required.");
      if (
        !input.paymentStatus ||
        !["paid", "authorized", "cod"].includes(input.paymentStatus)
      )
        throw new Error(
          "Payment must be paid, authorized, or COD before allocation.",
        );
      if (
        input.customerEmail?.trim() &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail.trim())
      )
        throw new Error("Customer email is invalid.");
      if (
        input.paymentDate &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate) ||
          Number.isNaN(Date.parse(input.paymentDate)))
      )
        throw new Error("Payment date must use YYYY-MM-DD.");
      for (const amount of [
        input.shippingFee,
        input.otherFees,
        input.reportedTotalAmount,
      ]) {
        if (amount !== undefined && amount < 0)
          throw new Error("Order amounts cannot be negative.");
      }
      for (const line of input.lines) {
        if (line.unitPrice !== undefined && line.unitPrice < 0)
          throw new Error("Unit price cannot be negative.");
        if (line.discountAmount !== undefined && line.discountAmount < 0)
          throw new Error("Discount amount cannot be negative.");
        if (
          line.unitPrice !== undefined &&
          line.discountAmount !== undefined &&
          line.discountAmount > line.unitPrice * line.quantity
        )
          throw new Error("Discount amount cannot exceed the line value.");
      }
    }
    if (input.source === "third_party") {
      if (!input.thirdPartyLocationId?.trim())
        throw new Error("A third-party location is required.");
      const custodyLocation = this.data.locations.find(
        (location) => location.id === input.thirdPartyLocationId,
      );
      if (
        !custodyLocation ||
        custodyLocation.active === false ||
        !["event_site", "vendor"].includes(custodyLocation.type)
      ) {
        throw new Error(
          "Third-party location must be an active event site or vendor custody location.",
        );
      }
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
      ecommerceChannel: input.ecommerceChannel?.trim() || undefined,
      orderDate: input.orderDate,
      customerName: input.customerName?.trim() || undefined,
      customerContact: input.customerContact?.trim() || undefined,
      customerEmail: input.customerEmail?.trim() || undefined,
      deliveryArea: input.deliveryArea?.trim() || undefined,
      deliveryAddress: input.deliveryAddress
        ? {
            addressLine: input.deliveryAddress.addressLine.trim(),
            city: input.deliveryAddress.city.trim(),
            province: input.deliveryAddress.province.trim(),
            postalCode: input.deliveryAddress.postalCode.trim(),
          }
        : undefined,
      paymentStatus: input.paymentStatus,
      paymentMethod: input.paymentMethod?.trim() || undefined,
      paymentReference: input.paymentReference?.trim() || undefined,
      paymentDate: input.paymentDate,
      paymentRrn: input.paymentRrn?.trim() || undefined,
      paymentProviderMethod: input.paymentProviderMethod?.trim() || undefined,
      paymentProviderStatus: input.paymentProviderStatus?.trim() || undefined,
      campaignName: input.campaignName?.trim() || undefined,
      salesInvoiceNumber: input.salesInvoiceNumber?.trim() || undefined,
      shippingFee: input.shippingFee,
      otherFees: input.otherFees,
      reportedTotalAmount: input.reportedTotalAmount,
      orderNotes: input.orderNotes?.trim() || undefined,
      eventId: input.eventId,
      thirdPartyLocationId: input.thirdPartyLocationId,
      grossSalesAmount: input.grossSalesAmount,
      currency: input.grossSalesAmount === undefined ? undefined : "PHP",
      deliveryMethod:
        input.deliveryMethod ?? deliveryMethodForSource(input.source),
      shipmentStatus:
        (input.deliveryMethod ?? deliveryMethodForSource(input.source)) ===
        "shipment"
          ? "awaiting_dispatch"
          : "not_applicable",
      shipmentEvents: [
        {
          status:
            (input.deliveryMethod ?? deliveryMethodForSource(input.source)) ===
            "shipment"
              ? "awaiting_dispatch"
              : "not_applicable",
          occurredAt: createdAt,
          actor: input.actor,
        },
      ],
      sourceLocationId: input.sourceLocationId,
      sourceBinId: input.sourceBinId,
      courier: input.courier?.trim() || undefined,
      deliveryLink: input.deliveryLink?.trim() || undefined,
      waybillNumber: input.waybillNumber?.trim() || undefined,
      status: "received",
      lines: input.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        pickedQuantity: 0,
        pickedSerialNumbers: [],
        bundleSetCodes: line.bundleSetCodes,
        variant: line.variant?.trim() || undefined,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        fulfillmentEvidenceUrl:
          line.fulfillmentEvidenceUrl?.trim() || undefined,
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

    if (input.action === "split_backorder") {
      const fulfilledLines = input.fulfilledLines ?? [];
      const backorderLines = order.lines.flatMap((line) => {
        const selection = fulfilledLines.find(
          (row) => row.productId === line.productId,
        );
        if (
          !selection ||
          selection.quantity <= 0 ||
          selection.quantity > line.quantity
        ) {
          throw new Error(
            "Every line must keep a positive quantity that does not exceed the original demand.",
          );
        }
        const remainder = line.quantity - selection.quantity;
        line.quantity = selection.quantity;
        return remainder > 0 ? [{ ...clone(line), quantity: remainder }] : [];
      });
      if (backorderLines.length === 0) {
        throw new Error("At least one line must have a backordered quantity.");
      }
      const sequence =
        this.data.fulfillmentOrders.filter(
          (row) => row.parentOrderId === order.id,
        ).length + 1;
      const createdAt = this.now();
      this.data.fulfillmentOrders.push({
        ...clone(order),
        id: this.newId("fulfillment-backorder"),
        externalReference: `${order.externalReference}-BO-${sequence}`,
        parentOrderId: order.id,
        status: "received",
        lines: backorderLines,
        packaging: [],
        createdBy: input.actor,
        createdAt,
        updatedAt: createdAt,
        pickedBy: undefined,
        pickedAt: undefined,
        packedBy: undefined,
        packedAt: undefined,
        releasedBy: undefined,
        releasedAt: undefined,
        acknowledgedBy: undefined,
        acknowledgedAt: undefined,
      });
      order.updatedAt = createdAt;
      this.persist();
      return clone(order);
    }

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
        const committed = this.data.fulfillmentReservations
          .filter(
            (reservation) =>
              reservation.status === "active" &&
              reservation.orderId !== order.id &&
              reservation.productId === line.productId &&
              (!sourceLocationId ||
                !reservation.locationId ||
                reservation.locationId === sourceLocationId) &&
              (!order.sourceBinId ||
                !reservation.binId ||
                reservation.binId === order.sourceBinId),
          )
          .reduce((sum, reservation) => sum + reservation.quantity, 0);
        if (available - committed < line.quantity) {
          throw new Error(
            `Only ${Math.max(0, available - committed)} of ${product.name} is available for this order.`,
          );
        }
      }
      const createdAt = this.now();
      for (const line of order.lines) {
        this.data.fulfillmentReservations.push({
          id: this.newId(`fulfillment-reservation-${line.productId}`),
          orderId: order.id,
          productId: line.productId,
          locationId: sourceLocationId,
          binId: order.sourceBinId,
          quantity: line.quantity,
          status: "active",
          createdBy: input.actor,
          createdAt,
        });
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
        const scannedBinId = selection.binId ?? order.sourceBinId;
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
              (!scannedBinId || row.binId === scannedBinId),
          );
          if (!unit)
            throw new Error(
              `Serial ${serialNumber} is not available in the scanned bin.`,
            );
        }
        if (!product.serialized && scannedBinId) {
          const availableAtBin = this.data.stockLevels
            .filter(
              (level) =>
                level.productId === product.id &&
                level.binId === scannedBinId &&
                (!sourceLocationId || level.locationId === sourceLocationId),
            )
            .reduce((sum, level) => sum + level.quantity, 0);
          if (availableAtBin < line.quantity) {
            throw new Error(
              `${product.name} is not available in the scanned bin.`,
            );
          }
        }
        line.pickedQuantity = selection.quantity;
        line.pickedSerialNumbers = serialNumbers;
        line.pickBinId = scannedBinId;
        line.fulfillmentEvidenceUrl =
          selection.evidenceUrl?.trim() || undefined;
      }
      order.pickedBy = input.actor;
      order.pickedAt = this.now();
    }

    if (input.action === "confirm_pack") {
      if (order.deliveryMethod === "shipment") {
        if (!input.courier?.trim() && !order.courier?.trim())
          throw new Error("Courier is required at packing.");
        if (!input.deliveryLink?.trim() && !order.deliveryLink?.trim())
          throw new Error("Delivery tracking link is required at packing.");
        if (!input.waybillNumber?.trim() && !order.waybillNumber?.trim())
          throw new Error("Waybill number is required at packing.");
      } else if (
        !input.handoverRecipientName?.trim() ||
        !input.handoverRecipientDepartment?.trim() ||
        !input.handoverReference?.trim()
      ) {
        throw new Error(
          "Recipient, department, and handover reference are required at packing.",
        );
      }
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
      order.courier = input.courier?.trim() || order.courier;
      order.deliveryLink = input.deliveryLink?.trim() || order.deliveryLink;
      order.waybillNumber = input.waybillNumber?.trim() || order.waybillNumber;
      order.handoverRecipientName =
        input.handoverRecipientName?.trim() || undefined;
      order.handoverRecipientDepartment =
        input.handoverRecipientDepartment?.trim() || undefined;
      order.handoverReference = input.handoverReference?.trim() || undefined;
      order.handoverEvidenceUrl =
        input.handoverEvidenceUrl?.trim() ||
        `intra://handover/${order.id}/${order.handoverReference}`;
      order.packaging = clone(input.packaging ?? []);
      order.packedBy = input.actor;
      order.packedAt = this.now();
    }

    if (input.action === "release") {
      const release = canReleaseFulfillmentOrder(order, input.actor);
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
      if (order.deliveryMethod === "shipment") {
        order.shipmentStatus = "dispatched";
        order.dispatchedAt = createdAt;
        order.lastTrackingAt = createdAt;
        order.shipmentEvents.push({
          status: "dispatched",
          occurredAt: createdAt,
          actor: input.actor,
          reference: order.waybillNumber,
        });
      }
      for (const reservation of this.data.fulfillmentReservations.filter(
        (row) => row.orderId === order.id && row.status === "active",
      )) {
        reservation.status = "released";
        reservation.closedAt = createdAt;
      }
    }

    if (input.action === "mark_in_transit") {
      if (order.deliveryMethod !== "shipment") {
        throw new Error("Courier tracking applies only to shipment orders.");
      }
      if (
        !["dispatched", "delivery_failed"].includes(order.shipmentStatus ?? "")
      ) {
        throw new Error(
          "Shipment cannot enter transit from its current state.",
        );
      }
      order.shipmentStatus = "in_transit";
      order.dispatchedAt ??= this.now();
      order.lastTrackingAt = this.now();
      order.deliveryFailureReason = undefined;
      order.shipmentEvents.push({
        status: "in_transit",
        occurredAt: order.lastTrackingAt,
        actor: input.actor,
        reference: input.trackingReference?.trim() || undefined,
      });
    }

    if (input.action === "record_delivery_failed") {
      if (!["dispatched", "in_transit"].includes(order.shipmentStatus ?? "")) {
        throw new Error(
          "Only a dispatched shipment can record failed delivery.",
        );
      }
      if (!input.deliveryFailureReason?.trim()) {
        throw new Error("A failed-delivery reason is required.");
      }
      order.shipmentStatus = "delivery_failed";
      order.deliveryFailureReason = input.deliveryFailureReason.trim();
      order.failedDeliveryAt = this.now();
      order.lastTrackingAt = order.failedDeliveryAt;
      order.shipmentEvents.push({
        status: "delivery_failed",
        occurredAt: order.failedDeliveryAt,
        actor: input.actor,
        reason: order.deliveryFailureReason,
      });
    }

    if (input.action === "confirm_delivery") {
      if (
        !["dispatched", "in_transit", "delivery_failed"].includes(
          order.shipmentStatus ?? "",
        )
      ) {
        throw new Error("Shipment cannot be delivered from its current state.");
      }
      if (
        !input.trackingReference?.trim() ||
        !input.trackingEvidenceUrl?.trim()
      ) {
        throw new Error(
          "Proof-of-delivery reference and evidence are required.",
        );
      }
      order.shipmentStatus = "delivered";
      order.proofOfDeliveryReference = input.trackingReference.trim();
      order.proofOfDeliveryEvidenceUrl = input.trackingEvidenceUrl.trim();
      order.deliveredAt = this.now();
      order.lastTrackingAt = order.deliveredAt;
      order.shipmentEvents.push({
        status: "delivered",
        occurredAt: order.deliveredAt,
        actor: input.actor,
        reference: order.proofOfDeliveryReference,
        evidenceUrl: order.proofOfDeliveryEvidenceUrl,
      });
    }

    if (input.action === "return_to_sender") {
      if (order.shipmentStatus !== "delivery_failed") {
        throw new Error("Only a failed delivery can return to sender.");
      }
      if (!input.deliveryFailureReason?.trim()) {
        throw new Error("A return-to-sender reason is required.");
      }
      order.shipmentStatus = "returned_to_sender";
      order.deliveryFailureReason = input.deliveryFailureReason.trim();
      order.lastTrackingAt = this.now();
      order.shipmentEvents.push({
        status: "returned_to_sender",
        occurredAt: order.lastTrackingAt,
        actor: input.actor,
        reason: order.deliveryFailureReason,
      });
    }
    if (input.action === "acknowledge_receipt") {
      if (order.releasedBy === input.actor) {
        throw new Error("The releasing operator cannot acknowledge receipt.");
      }
      if (!input.acknowledgementReference?.trim()) {
        throw new Error("An acknowledgment reference is required.");
      }
      if (!input.acknowledgementEvidenceUrl?.trim()) {
        throw new Error("Acknowledgment evidence is required.");
      }
      order.acknowledgedBy = input.actor;
      order.acknowledgedAt = this.now();
      order.acknowledgementReference = input.acknowledgementReference.trim();
      order.acknowledgementEvidenceUrl =
        input.acknowledgementEvidenceUrl.trim();
    }

    if (input.action === "cancel") {
      if (!input.cancellationReason?.trim()) {
        throw new Error("A cancellation reason is required.");
      }
      const prepared = ["packing", "ready"].includes(order.status);
      if (
        prepared &&
        order.packaging.length > 0 &&
        !input.packagingDisposition
      ) {
        throw new Error(
          "Choose whether prepared packaging was consumed or returned.",
        );
      }
      order.cancellationReason = input.cancellationReason.trim();
      order.packagingDisposition = input.packagingDisposition;
      const cancelledAt = this.now();
      if (prepared && input.packagingDisposition === "consumed") {
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
            throw new Error("Packaging stock changed before cancellation.");
          }
          for (const level of levels) {
            const take = Math.min(level.quantity, remaining);
            level.quantity -= take;
            remaining -= take;
            if (take > 0) {
              this.data.movements.push({
                id: this.newId("mv"),
                type: "packaging_consumption",
                productId: material.productId,
                quantity: take,
                fromLocationId: level.locationId,
                fromBinId: level.binId,
                reference: order.id,
                reason: `Cancelled after packing: ${order.cancellationReason}`,
                actor: input.actor,
                createdAt: cancelledAt,
              });
            }
          }
        }
      }
      for (const reservation of this.data.fulfillmentReservations.filter(
        (row) => row.orderId === order.id && row.status === "active",
      )) {
        reservation.status = "cancelled";
        reservation.closedAt = cancelledAt;
      }
    }

    order.status = nextStatus;
    order.updatedAt = this.now();
    this.syncDepartmentRequest(order);
    this.persist();
    return clone(order);
  }

  async createDepartmentStockRequest(
    input: CreateDepartmentStockRequestInput,
  ): Promise<DepartmentStockRequest> {
    const errors = validateDepartmentRequest(input);
    if (errors.length > 0) throw new Error(errors.join(" "));
    if (
      this.data.departmentRequestOptions.length > 0 &&
      !this.data.departmentRequestOptions.some(
        (option) =>
          option.departmentCode === input.requestingDepartment.trim() &&
          option.costCenterCode === input.costCenter.trim(),
      )
    ) {
      throw new Error(
        "Select an active cost center for the requesting department.",
      );
    }
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
        return !["sellable_sku", "merchandise", "event_material"].includes(
          itemClass,
        );
      })
    ) {
      throw new Error(
        "Department requests may include only sellable SKU, merchandise, and event material items.",
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
    if (!record || ["resolved", "closed"].includes(record.status))
      throw new Error("Open return case not found.");
    if (!input.quarantineBinId) {
      throw new Error(
        "A quarantine bin is required before any return resolution.",
      );
    }
    if (
      input.resolution === "vendor_return" &&
      !input.supplierReference?.trim()
    ) {
      throw new Error(
        "A supplier RMA reference is required for vendor return.",
      );
    }
    if (input.resolution === "refund" && !input.refundReference?.trim()) {
      throw new Error("Finance refund reference is required.");
    }
    if (
      ["refund", "write_off"].includes(input.resolution) &&
      !input.financeEvidenceUrl?.trim()
    ) {
      throw new Error(
        "Finance evidence is required for refunds and write-offs.",
      );
    }
    let replacementOrderId = input.replacementOrderId;
    if (input.resolution === "replacement" && !replacementOrderId) {
      const sourceOrder = this.data.fulfillmentOrders.find(
        (order) => order.id === record.sourceOrderId,
      );
      const replacement = await this.createFulfillmentOrder({
        source: "ecommerce",
        externalReference: "REPL-" + record.id,
        sourceLocationId: sourceOrder?.sourceLocationId,
        customerReference: sourceOrder?.customerReference ?? record.id,
        lines: [{ productId: record.productId, quantity: 1 }],
        actor: input.actor,
      });
      replacementOrderId = replacement.id;
    }
    record.status = "resolved";
    record.resolution = input.resolution;
    record.quarantineBinId = input.quarantineBinId;
    record.replacementOrderId = replacementOrderId;
    record.refundReference = input.refundReference?.trim();
    record.supplierReference = input.supplierReference?.trim();
    record.financeEvidenceUrl = input.financeEvidenceUrl?.trim();
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

  async closeCustomerReturnCase(
    input: CloseCustomerReturnCaseInput,
  ): Promise<CustomerReturnCase> {
    const record = this.data.customerReturnCases.find(
      (row) => row.id === input.returnCaseId,
    );
    if (!record || record.status !== "resolved") {
      throw new Error(
        "A resolved return case is required for customer closure.",
      );
    }
    if (
      !input.customerResolutionReference.trim() ||
      !input.customerClosureEvidenceUrl.trim()
    ) {
      throw new Error(
        "Customer resolution reference and closure evidence are required.",
      );
    }
    record.status = "closed";
    record.customerResolutionReference =
      input.customerResolutionReference.trim();
    record.customerClosureEvidenceUrl = input.customerClosureEvidenceUrl.trim();
    record.customerClosedBy = input.actor;
    record.customerClosedAt = this.now();
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
        createdAt: po.createdAt,
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
    return this.idempotent(
      "receive_procurement_po",
      input.idempotencyKey,
      input,
      () => {
        const purchaseOrder = this.data.purchaseOrders.find(
          (row) => row.id === input.poId,
        );
        if (!purchaseOrder) throw new Error("Procurement purchase order not found.");
        const cleanLines = input.lines
          .map((line, lineIndex) => {
            const quantity =
              line.mode === "breakdown"
                ? line.outcomes.clean.quantity
                : line.quantity;
            const serialNumbers =
              line.mode === "breakdown"
                ? (line.outcomes.clean.serialNumbers ?? []).map(normalizeSerialIdentity)
                : line.serialNumbers?.map(normalizeSerialIdentity);
            if (line.mode === "breakdown") {
              const reconciled =
                line.outcomes.clean.quantity +
                line.outcomes.damaged.quantity +
                line.outcomes.unidentified.quantity +
                line.outcomes.short.quantity;
              if (reconciled !== line.expectedQuantity) {
                throw new Error("Receipt outcomes must reconcile to expected quantity.");
              }
              const product = this.data.products.find(
                (row) => row.id === line.productId,
              );
              const physicalSerials = [
                ...(line.outcomes.clean.serialNumbers ?? []),
                ...(line.outcomes.damaged.serialNumbers ?? []),
                ...(line.outcomes.unidentified.serialNumbers ?? []),
                ...(line.outcomes.excess.serialNumbers ?? []),
              ].map(normalizeSerialIdentity);
              if (physicalSerials.some((serialNumber) => !serialNumber)) {
                throw new Error("Receipt serial identity cannot be blank.");
              }
              if (new Set(physicalSerials).size !== physicalSerials.length) {
                throw new Error("Receipt serial identities must be unique.");
              }
              if (
                physicalSerials.some((serialNumber) =>
                  this.data.units.some(
                    (unit) => normalizeSerialIdentity(unit.serialNumber) === serialNumber,
                  ),
                )
                || physicalSerials.some((serialNumber) =>
                  this.procurementReceiptSerialClaims.has(serialNumber),
                )
              ) {
                throw new Error("Receipt serial identity is already claimed.");
              }
              if (
                product?.serialized &&
                ["clean", "damaged", "unidentified", "excess"].some(
                  (outcome) => {
                    const physical = line.outcomes[
                      outcome as keyof typeof line.outcomes
                    ];
                    return (
                      "serialNumbers" in physical &&
                      (physical.serialNumbers?.length ?? 0) !== physical.quantity
                    );
                  },
                )
              ) {
                throw new Error(
                  "Each serialized physical outcome requires exact serial identities.",
                );
              }
              const poLine = purchaseOrder.lines[lineIndex];
              if (!poLine || `${purchaseOrder.id}-${lineIndex}` !== line.lineId) {
                throw new Error("Procurement PO line binding is invalid.");
              }
            }
            return {
              productId: line.productId,
              quantity,
              lotCode: line.lotCode,
              serialNumbers,
              binId: input.binId,
            };
          })
          .filter((line) => line.quantity > 0);
        const receipt = this.receiveStockOnce(
          {
            locationId: input.locationId,
            lines: cleanLines,
            evidenceUrls: input.evidenceUrls,
            actor: "demo-procurement-receiver",
          },
          input.idempotencyKey,
        );
        const storedReceipt = this.data.receipts.find(
          (row) => row.id === receipt.id,
        )!;
        storedReceipt.procurementPoId = input.poId;
        if (input.mode === "breakdown") {
          input.lines.forEach((line, lineIndex) => {
            const poLine = purchaseOrder.lines[lineIndex]!;
            poLine.quantityReceived += line.outcomes.clean.quantity;
            for (const outcome of [
              "damaged",
              "unidentified",
              "short",
              "excess",
            ] as const) {
              if (line.outcomes[outcome].quantity <= 0) continue;
              if (outcome !== "short") {
                for (const serialNumber of
                  line.outcomes[outcome].serialNumbers ?? []) {
                  this.procurementReceiptSerialClaims.set(normalizeSerialIdentity(serialNumber), {
                    receiptId: storedReceipt.id,
                    outcome,
                  });
                }
              }
              this.exceptions.push({
                id: `ex-${input.idempotencyKey}-${lineIndex}-${outcome}`,
                type: "po_receipt",
                severity: ["unidentified", "excess"].includes(outcome)
                  ? "P1"
                  : "P2",
                sourceType: outcome,
                sourceId: storedReceipt.id,
                status: "open",
                createdAt: storedReceipt.createdAt,
              });
            }
          });
        }
        this.persist();
        return clone(storedReceipt);
      },
    );
  }
}
