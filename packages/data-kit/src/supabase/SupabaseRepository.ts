import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Allocation,
  CycleCount,
  Location,
  Lot,
  Movement,
  Product,
  PurchaseOrder,
  Receipt,
  ReturnRecord,
  StorageArea,
  Supplier,
  WarehouseEvent,
} from '../domain/types';
import {
  normalizePageQuery,
  type CreateVendorReturnInput,
  type DecideStockChangeInput,
  type InspectQualityInput,
  type InventoryHold,
  type InventoryPosition,
  type OperationRoute,
  type PageQuery,
  type PageResult,
  type ProcurementPOHandoff,
  type QualityInspection,
  type ReceiveProcurementPOInput,
  type ReleaseHoldInput,
  type ResolveExceptionInput,
  type StockChangeRequest,
  type SubmitCycleCountInput,
  type UpdateOperationRouteInput,
  type WarehouseException,
  type WarehouseTask,
  type VendorReturn,
} from '../domain/warehouseControls';
import { returnClosesAllocation, validateReservation } from '../domain/allocations';
import { primaryStockLocation, validateTransfer } from '../domain/transfers';
import { poStatusAfterReceipt } from '../domain/purchaseOrders';
import { applyProductPatch, buildNewProduct } from '../domain/products';
import {
  toStockState,
  type AdjustStockInput,
  type CancelAllocationInput,
  type CancelPurchaseOrderInput,
  type CreateEventInput,
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
  type WarehouseRepository,
} from '../repository';
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  allocationToRow,
  eventToRow,
  lotToRow,
  movementToRow,
  poToRow,
  productToRow,
  rowToAllocation,
  rowToCycleCount,
  rowToException,
  rowToEvent,
  rowToHold,
  rowToInventoryPosition,
  rowToLocation,
  rowToLot,
  rowToMovement,
  rowToProduct,
  rowToOperationRoute,
  rowToOperationType,
  rowToQualityInspection,
  rowToProfile,
  rowToPurchaseOrder,
  rowToReceipt,
  rowToReturn,
  rowToStockLevel,
  rowToStorageArea,
  rowToStockChangeRequest,
  rowToSupplier,
  rowToUnit,
  rowToWarehouseTask,
  rowToVendorReturn,
  storageAreaToRow,
  supplierToRow,
  unitToRow,
} from './mappers';

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Snake-case row shape passed to / returned from the SQL layer. */
type Row = Record<string, unknown>;

const TABLE_PROJECTIONS: Record<string, string> = {
  products: 'id,sku,name,category,device_type,merchandise_type,serialized,attributes,unit_cost,price,reorder_point,promotional,barcode,expiry_tracked,shelf_life_warning_days',
  locations: 'id,name,type',
  storage_areas: 'id,location_id,code,label,zone,active',
  suppliers: 'id,name,lead_time_days',
  lots: 'id,product_id,lot_code,supplier_id,unit_cost,received_at,expiry_date',
  inventory_units: 'id,product_id,serial_number,lot_id,location_id,bin_id,status,assigned_to,event_id',
  stock_levels: 'product_id,location_id,bin_id,lot_id,quantity',
  movements: 'id,type,product_id,quantity,from_location_id,to_location_id,from_bin_id,to_bin_id,lot_id,serial_number,event_id,reason,reference,evidence_urls,actor,created_at',
  allocations: 'id,event_id,product_id,quantity,status,promotional,created_at',
  events: 'id,name,type,site_location_id,start_date,end_date',
  returns: 'id,source,event_id,lines,evidence_urls,actor,created_at',
  cycle_counts: 'id,location_id,bin_id,category,lines,status,requested_by,submitted_at,actor,created_at',
  receipts: 'id,supplier_id,location_id,lines,evidence_urls,operation_route_id,procurement_po_id,quality_status,actor,created_at',
  purchase_orders: 'id,supplier_id,status,lines,expected_date,actor,created_at',
  profiles: 'id,role,name,email,title',
  operation_types: 'id,code,label,active',
  operation_routes: 'id,operation_type_id,source_location_types,destination_location_types,requires_evidence,requires_approval,requires_online,active',
  quality_inspections: 'id,source_type,source_id,product_id,bin_id,lot_id,serial_number,quantity,disposition,reason,evidence_urls,inspected_by,created_at',
  inventory_holds: 'id,inspection_id,product_id,location_id,bin_id,lot_id,serial_number,quantity,status,reason,created_by,created_at,released_by,released_at',
  vendor_returns: 'id,hold_id,supplier_id,source_receipt_id,source_return_id,product_id,lot_id,serial_number,quantity,reason,reference,status,evidence_urls,created_by,created_at,handed_off_by,handed_off_at,completed_at',
  exceptions: 'id,exception_type,severity,source_type,source_id,status,owner_id,due_at,resolution,created_at',
  stock_change_requests: 'id,source_type,source_id,product_id,location_id,bin_id,quantity_delta,unit_cost,financial_impact,reason,evidence_urls,status,requested_by,requested_at,created_at',
  warehouse_tasks: 'id,task_type,source_id,title,status,assignee_id,due_at,completed_at,created_at',
  inventory_position_v1: 'id,product_id,location_id,bin_id,on_hand,committed,held,unavailable,available,created_at',
  procurement_po_handoff: 'id,po_number,vendor_name,status,expected_date,lines',
};

const BOUNDED_HISTORY = new Set([
  'movements',
  'returns',
  'cycle_counts',
  'receipts',
  'purchase_orders',
]);
const OPERATIONAL_HISTORY_LIMIT = 5000;

/**
 * Supabase-backed repository. Mutations mirror the in-memory adapter's logic but
 * persist to Postgres. Reads hydrate the full warehouse read model.
 */
export class SupabaseRepository implements WarehouseControlRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async select<T>(table: string, map: (r: never) => T): Promise<T[]> {
    const projection = TABLE_PROJECTIONS[table];
    if (!projection) throw new Error(`No safe projection configured for ${table}.`);
    let query: any = this.db.from(table).select(projection);
    if (BOUNDED_HISTORY.has(table)) {
      query = query.order('created_at', { ascending: false }).limit(OPERATIONAL_HISTORY_LIMIT);
    }
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []).map((r: unknown) => map(r as never));
  }

  async getData(): Promise<WarehouseData> {
    const [
      products,
      locations,
      storageAreas,
      suppliers,
      lots,
      units,
      stockLevels,
      movements,
      allocations,
      events,
      returns,
      cycleCounts,
      receipts,
      purchaseOrders,
      operationTypes,
      operationRoutes,
    ] = await Promise.all([
      this.select('products', rowToProduct),
      this.select('locations', rowToLocation),
      this.select('storage_areas', rowToStorageArea),
      this.select('suppliers', rowToSupplier),
      this.select('lots', rowToLot),
      this.select('inventory_units', rowToUnit),
      this.select('stock_levels', rowToStockLevel),
      this.select('movements', rowToMovement),
      this.select('allocations', rowToAllocation),
      this.select('events', rowToEvent),
      this.select('returns', rowToReturn),
      this.select('cycle_counts', rowToCycleCount),
      this.select('receipts', rowToReceipt),
      this.select('purchase_orders', rowToPurchaseOrder),
      this.select('operation_types', rowToOperationType),
      this.select('operation_routes', rowToOperationRoute),
    ]);
    return {
      products,
      locations,
      storageAreas,
      suppliers,
      lots,
      units,
      stockLevels,
      movements,
      allocations,
      events,
      returns,
      cycleCounts,
      receipts,
      purchaseOrders,
      operationTypes,
      operationRoutes,
    };
  }

  async getStockState() {
    return toStockState(await this.getData());
  }

  async getProfiles() {
    return this.select('profiles', rowToProfile);
  }

  /**
   * Invokes a transactional Postgres RPC (see the `transactional_rpcs`
   * migration). The whole multi-step mutation commits or rolls back atomically,
   * so a mid-operation failure can never leave stock / units / movements /
   * documents out of sync. Returns the primary row the function emits.
   */
  private async callRpc(
    fn: string,
    payload: Record<string, unknown>,
  ): Promise<Row> {
    const { data, error } = await this.db.rpc(fn, { payload });
    if (error) throw new Error(error.message);
    return data as Row;
  }

  private async listControl<T>(
    table: string,
    query: PageQuery,
    map: (row: never) => T,
    statusColumn: string | null = 'status',
  ): Promise<PageResult<T>> {
    const normalized = normalizePageQuery(query);
    const projection = TABLE_PROJECTIONS[table];
    if (!projection) throw new Error(`No safe projection configured for ${table}.`);
    let request: any = this.db.from(table).select(projection);
    if (normalized.status && statusColumn) {
      request = request.eq(statusColumn, normalized.status);
    }
    if (normalized.cursor) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(decodeURIComponent(normalized.cursor));
      } catch {
        throw new Error('Invalid page cursor.');
      }
      if (
        !Array.isArray(decoded) || decoded.length !== 2 ||
        typeof decoded[0] !== 'string' || Number.isNaN(Date.parse(decoded[0])) ||
        typeof decoded[1] !== 'string' || !/^[A-Za-z0-9_|-]{1,200}$/.test(decoded[1])
      ) {
        throw new Error('Invalid page cursor.');
      }
      request = request.or(
        `created_at.lt.${decoded[0]},and(created_at.eq.${decoded[0]},id.lt.${decoded[1]})`,
      );
    }
    request = request
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(normalized.limit + 1);
    const { data, error } = await request;
    if (error) throw new Error(`${table}: ${error.message}`);
    const raw = (data ?? []) as Row[];
    const rows = raw.slice(0, normalized.limit);
    const last = rows.at(-1);
    return {
      rows: rows.map((row) => map(row as never)),
      ...(raw.length > normalized.limit && last
        ? { nextCursor: encodeURIComponent(JSON.stringify([last.created_at, last.id])) }
        : {}),
    };
  }

  listQualityInspections(query: PageQuery): Promise<PageResult<QualityInspection>> {
    return this.listControl('quality_inspections', query, rowToQualityInspection, 'disposition');
  }

  listHolds(query: PageQuery): Promise<PageResult<InventoryHold>> {
    return this.listControl('inventory_holds', query, rowToHold);
  }

  listVendorReturns(query: PageQuery): Promise<PageResult<VendorReturn>> {
    return this.listControl('vendor_returns', query, rowToVendorReturn);
  }

  listExceptions(query: PageQuery): Promise<PageResult<WarehouseException>> {
    return this.listControl('exceptions', query, rowToException);
  }

  listStockChangeRequests(query: PageQuery): Promise<PageResult<StockChangeRequest>> {
    return this.listControl('stock_change_requests', query, rowToStockChangeRequest);
  }

  listWarehouseTasks(query: PageQuery): Promise<PageResult<WarehouseTask>> {
    return this.listControl('warehouse_tasks', query, rowToWarehouseTask);
  }

  listInventoryPositions(query: PageQuery): Promise<PageResult<InventoryPosition>> {
    return this.listControl('inventory_position_v1', query, rowToInventoryPosition, null);
  }

  async inspectQuality(input: InspectQualityInput): Promise<QualityInspection> {
    const response = await this.callRpc('inspect_quality', {
      idempotency_key: input.idempotencyKey,
      source_type: input.sourceType,
      source_id: input.sourceId,
      product_id: input.productId,
      bin_id: input.binId ?? null,
      lot_id: input.lotId ?? null,
      serial_number: input.serialNumber ?? null,
      quantity: input.quantity,
      disposition: input.disposition,
      reason: input.reason ?? null,
      evidence_urls: input.evidenceUrls ?? [],
    });
    return rowToQualityInspection(response.inspection as never);
  }

  async releaseHold(input: ReleaseHoldInput): Promise<InventoryHold> {
    return rowToHold(await this.callRpc('release_quality_hold', {
      idempotency_key: input.idempotencyKey,
      hold_id: input.holdId,
      target_disposition: input.targetDisposition,
      reason: input.reason,
      evidence_urls: input.evidenceUrls ?? [],
    }) as never);
  }

  async createVendorReturn(input: CreateVendorReturnInput): Promise<VendorReturn> {
    return rowToVendorReturn(await this.callRpc('create_vendor_return', {
      idempotency_key: input.idempotencyKey,
      hold_id: input.holdId,
      supplier_id: input.supplierId,
      reason: input.reason,
      reference: input.reference,
      evidence_urls: input.evidenceUrls ?? [],
    }) as never);
  }

  async updateOperationRoute(input: UpdateOperationRouteInput): Promise<OperationRoute> {
    return rowToOperationRoute(await this.callRpc('update_operation_route', {
      idempotency_key: input.idempotencyKey,
      route_id: input.routeId,
      patch: {
        source_location_types: input.patch.sourceLocationTypes,
        destination_location_types: input.patch.destinationLocationTypes,
        requires_evidence: input.patch.requiresEvidence,
        requires_approval: input.patch.requiresApproval,
        requires_online: input.patch.requiresOnline,
        active: input.patch.active,
      },
    }) as never);
  }

  async submitCycleCount(input: SubmitCycleCountInput): Promise<StockChangeRequest[]> {
    const response = await this.callRpc('submit_cycle_count', {
      idempotency_key: input.idempotencyKey,
      cycle_count_id: input.cycleCountId,
      reason: input.reason,
      evidence_urls: input.evidenceUrls ?? [],
    });
    return ((response.requests as Row[] | undefined) ?? []).map((row) =>
      rowToStockChangeRequest(row),
    );
  }

  async decideStockChange(input: DecideStockChangeInput): Promise<StockChangeRequest> {
    return rowToStockChangeRequest(await this.callRpc('decide_stock_change', {
      idempotency_key: input.idempotencyKey,
      request_id: input.requestId,
      decision: input.decision,
      note: input.note ?? null,
    }) as never);
  }

  async resolveException(input: ResolveExceptionInput): Promise<WarehouseException> {
    return rowToException(await this.callRpc('resolve_exception', {
      idempotency_key: input.idempotencyKey,
      exception_id: input.exceptionId,
      action: input.action,
      owner_id: input.ownerId ?? null,
      resolution: input.resolution ?? null,
      evidence_urls: input.evidenceUrls ?? [],
    }) as never);
  }

  async getReceivableProcurementPOs(): Promise<ProcurementPOHandoff[]> {
    const projection = TABLE_PROJECTIONS.procurement_po_handoff!;
    const { data, error } = await this.db
      .from('procurement_po_handoff')
      .select(projection)
      .order('expected_date', { ascending: true })
      .limit(500);
    if (error) throw new Error(`procurement_po_handoff: ${error.message}`);
    return ((data ?? []) as unknown as Row[]).map((row) => ({
      id: String(row.id),
      poNumber: String(row.po_number),
      vendorName: String(row.vendor_name),
      status: row.status as ProcurementPOHandoff['status'],
      expectedDate: row.expected_date == null ? undefined : String(row.expected_date),
      lines: (row.lines ?? []) as ProcurementPOHandoff['lines'],
    }));
  }

  async receiveProcurementPO(input: ReceiveProcurementPOInput): Promise<Receipt> {
    const response = await this.callRpc('receive_procurement_po', {
      idempotency_key: input.idempotencyKey,
      po_id: input.poId,
      location_id: input.locationId,
      bin_id: input.binId ?? null,
      lines: input.lines.map((line) => ({
        line_id: line.lineId,
        product_id: line.productId,
        quantity: line.quantity,
        lot_code: line.lotCode ?? null,
        expiry_date: line.expiryDate ?? null,
        serial_numbers: line.serialNumbers ?? [],
      })),
      evidence_urls: input.evidenceUrls ?? [],
    });
    return rowToReceipt(response.receipt as never);
  }

  async receiveStock(input: ReceiveStockInput): Promise<Receipt> {
    const createdAt = new Date().toISOString();
    const data = await this.getData();
    const receipt: Receipt = {
      id: uid('rcpt'),
      supplierId: input.supplierId,
      locationId: input.locationId,
      lines: input.lines,
      evidenceUrls: input.evidenceUrls,
      actor: input.actor,
      createdAt,
    };

    const lots: Row[] = [];
    const units: Row[] = [];
    const movements: Row[] = [];
    // Aggregate additive stock by (product, location) so one operation never
    // emits two rows with the same upsert conflict key.
    const stockByKey = new Map<string, Row>();

    for (const line of input.lines) {
      const product = data.products.find((p) => p.id === line.productId);
      if (!product) throw new Error(`Unknown product: ${line.productId}`);

      // Capture a lot whenever a unit cost or lot code is supplied so receipts
      // feed landed-cost / pricing analytics.
      let lotId: string | undefined;
      if (line.unitCost != null || line.lotCode || line.expiryDate) {
        const lot: Lot = {
          id: uid('lot'),
          productId: product.id,
          lotCode: line.lotCode ?? `LOT-${product.sku}-${Date.now()}`,
          supplierId: input.supplierId,
          unitCost: line.unitCost ?? product.unitCost,
          receivedAt: createdAt,
          expiryDate: line.expiryDate,
        };
        lots.push(lotToRow(lot));
        lotId = lot.id;
      }

      if (product.serialized) {
        const serials = line.serialNumbers?.length
          ? line.serialNumbers
          : Array.from(
              { length: line.quantity },
              (_, i) => `${product.sku}-SN${Date.now()}${i}`,
            );
        for (const serialNumber of serials) {
          units.push(
            unitToRow({
              id: uid('unit'),
              productId: product.id,
              serialNumber,
              lotId,
              locationId: input.locationId,
              binId: line.binId,
              status: 'in_stock',
            }),
          );
        }
      } else {
        const key = `${product.id}|${input.locationId}|${line.binId ?? ''}`;
        let entry = stockByKey.get(key);
        if (!entry) {
          entry = {
            product_id: product.id,
            location_id: input.locationId,
            bin_id: line.binId ?? null,
            lot_id: null,
            delta: 0,
          };
          stockByKey.set(key, entry);
        }
        entry.delta = (entry.delta as number) + line.quantity;
      }

      movements.push(
        movementToRow({
          id: uid('mv'),
          type: 'receipt',
          productId: product.id,
          quantity: line.quantity,
          toLocationId: input.locationId,
          toBinId: line.binId,
          lotId,
          reference: receipt.id,
          evidenceUrls: input.evidenceUrls,
          actor: input.actor,
          createdAt,
        }),
      );
    }

    const row = await this.callRpc('receive_stock', {
      lots,
      units,
      stock_deltas: [...stockByKey.values()],
      movements,
      receipt: {
        id: receipt.id,
        supplier_id: receipt.supplierId ?? null,
        location_id: receipt.locationId,
        lines: receipt.lines,
        evidence_urls: receipt.evidenceUrls ?? [],
        actor: receipt.actor,
        created_at: createdAt,
      },
    });
    return rowToReceipt(row);
  }

  async reserve(input: ReserveInput): Promise<Allocation> {
    // Client-side pre-check keeps the UX error message friendly; the RPC
    // re-validates ATP inside its transaction so concurrent reservations can't
    // both pass against a stale snapshot.
    const data = await this.getData();
    const result = validateReservation(
      toStockState(data),
      data.allocations,
      input.productId,
      input.quantity,
    );
    if (!result.ok) throw new Error(result.error);

    const allocation: Allocation = {
      id: uid('alloc'),
      eventId: input.eventId,
      productId: input.productId,
      quantity: input.quantity,
      status: 'reserved',
      promotional: input.promotional,
      createdAt: new Date().toISOString(),
    };
    const row = await this.callRpc('reserve', {
      product_id: input.productId,
      quantity: input.quantity,
      allocation: allocationToRow(allocation),
    });
    return rowToAllocation(row);
  }

  async issue(input: IssueInput): Promise<Allocation> {
    const data = await this.getData();
    const allocation = data.allocations.find((a) => a.id === input.allocationId);
    if (!allocation) throw new Error('Allocation not found.');
    if (allocation.status === 'issued')
      throw new Error('Allocation already issued.');
    const product = data.products.find((p) => p.id === allocation.productId);
    if (!product) throw new Error('Product not found.');
    const createdAt = new Date().toISOString();

    const sourceLocationId =
      input.sourceLocationId ??
      primaryStockLocation(toStockState(data), product.id);

    const unitIds: string[] = [];
    const stockDeltas: Row[] = [];
    if (product.serialized) {
      const serials = input.serialNumbers ?? [];
      const candidates = data.units.filter(
        (u) =>
          u.productId === product.id &&
          u.status === 'in_stock' &&
          (sourceLocationId === undefined || u.locationId === sourceLocationId) &&
          (input.sourceBinId === undefined || u.binId === input.sourceBinId),
      );
      let toIssue = allocation.quantity;
      for (const unit of candidates) {
        if (toIssue <= 0) break;
        if (serials.length > 0 && !serials.includes(unit.serialNumber)) continue;
        unitIds.push(unit.id);
        toIssue--;
      }
      if (toIssue > 0) {
        throw new Error(
          `Only ${allocation.quantity - toIssue} of ${allocation.quantity} unit(s) available to issue.`,
        );
      }
    } else {
      // Draw down across every matching bin so stock split across bins can't be
      // left behind (which would flip the allocation to issued while leaving
      // phantom stock on the book).
      const levels = data.stockLevels.filter(
        (s) =>
          s.productId === product.id &&
          (sourceLocationId === undefined || s.locationId === sourceLocationId) &&
          (input.sourceBinId === undefined ||
            (s.binId ?? undefined) === input.sourceBinId),
      );
      const total = levels.reduce((sum, s) => sum + s.quantity, 0);
      if (total < allocation.quantity) {
        throw new Error(
          `Insufficient stock to issue ${allocation.quantity} at the selected source.`,
        );
      }
      let remaining = allocation.quantity;
      for (const level of levels) {
        if (remaining <= 0) break;
        const take = Math.min(level.quantity, remaining);
        if (take <= 0) continue;
        stockDeltas.push({
          product_id: product.id,
          location_id: level.locationId,
          bin_id: level.binId ?? null,
          delta: -take,
        });
        remaining -= take;
      }
    }

    const movement = movementToRow({
      id: uid('mv'),
      type: 'issue',
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

    const row = await this.callRpc('issue', {
      unit_ids: unitIds,
      assigned_to: input.assignedTo ?? null,
      event_id: allocation.eventId,
      stock_deltas: stockDeltas,
      allocation_id: allocation.id,
      movement,
    });
    return rowToAllocation(row);
  }

  async recordReturn(input: ReturnInput): Promise<ReturnRecord> {
    const createdAt = new Date().toISOString();
    const data = await this.getData();
    const record: ReturnRecord = {
      id: uid('ret'),
      source: input.source,
      eventId: input.eventId,
      lines: input.lines,
      evidenceUrls: input.evidenceUrls,
      actor: input.actor,
      createdAt,
    };

    const unitUpdates: Row[] = [];
    const movements: Row[] = [];
    // Aggregate additive restock by (product, location) for a single upsert key.
    const stockByKey = new Map<string, Row>();

    for (const line of input.lines) {
      const product = data.products.find((p) => p.id === line.productId);
      if (!product) throw new Error(`Unknown product: ${line.productId}`);
      const disposition = line.disposition ?? 'restock';

      if (product.serialized && line.serialNumber) {
        const status =
          disposition === 'restock'
            ? 'in_stock'
            : disposition === 'lost'
              ? 'lost'
              : 'returned';
        const update: Row = { serial_number: line.serialNumber, status };
        // A restocked unit physically re-enters the warehouse at the chosen
        // location/bin — persist that so it's found by scan-to-bin.
        if (disposition === 'restock' && line.locationId) {
          update.location_id = line.locationId;
          update.bin_id = line.binId ?? null;
        }
        unitUpdates.push(update);
      } else if (!product.serialized && disposition === 'restock') {
        const targetLoc =
          line.locationId ?? primaryStockLocation(toStockState(data), product.id);
        if (targetLoc) {
          const key = `${product.id}|${targetLoc}|${line.binId ?? ''}`;
          let entry = stockByKey.get(key);
          if (!entry) {
            entry = {
              product_id: product.id,
              location_id: targetLoc,
              bin_id: line.binId ?? null,
              lot_id: null,
              delta: 0,
            };
            stockByKey.set(key, entry);
          }
          entry.delta = (entry.delta as number) + line.quantity;
        }
      }
      movements.push(
        movementToRow({
          id: uid('mv'),
          type: 'return',
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
        }),
      );
    }

    // Only close the allocation when this return fully accounts for it. Partial
    // serialized returns keep the allocation `issued` until all units are back.
    let allocationId: string | null = null;
    if (input.allocationId) {
      const allocation = data.allocations.find(
        (a) => a.id === input.allocationId,
      );
      if (allocation && allocation.status === 'issued') {
        const product = data.products.find((p) => p.id === allocation.productId);
        if (returnClosesAllocation(allocation, product, input.lines, data.units)) {
          allocationId = allocation.id;
        }
      }
    }

    const row = await this.callRpc('record_return', {
      unit_updates: unitUpdates,
      stock_deltas: [...stockByKey.values()],
      movements,
      allocation_id: allocationId,
      return: {
        id: record.id,
        source: record.source,
        event_id: record.eventId ?? null,
        lines: record.lines,
        evidence_urls: record.evidenceUrls ?? [],
        actor: record.actor,
        created_at: createdAt,
      },
    });
    return rowToReturn(row);
  }

  async recordCycleCount(input: CycleCountInput): Promise<CycleCount> {
    const createdAt = new Date().toISOString();
    const count: CycleCount = {
      id: uid('cc'),
      locationId: input.locationId,
      binId: input.binId,
      category: input.category,
      lines: input.lines,
      status: 'draft',
      requestedBy: input.actor,
      actor: input.actor,
      createdAt,
    };

    const row = await this.callRpc('record_cycle_count', {
      cycle_count: {
        id: count.id,
        location_id: count.locationId,
        bin_id: count.binId ?? null,
        category: count.category ?? null,
        lines: count.lines,
        status: 'draft',
        created_at: createdAt,
      },
    });
    return rowToCycleCount(row);
  }

  async transfer(input: TransferInput): Promise<Movement[]> {
    const data = await this.getData();
    const result = validateTransfer(
      toStockState(data),
      input.productId,
      input.fromLocationId,
      input.toLocationId,
      input.quantity,
    );
    if (!result.ok) throw new Error(result.error);

    const product = data.products.find((p) => p.id === input.productId);
    if (!product) throw new Error(`Unknown product: ${input.productId}`);
    const createdAt = new Date().toISOString();

    const unitIds: string[] = [];
    let fromStockDelta: Row | null = null;
    let toStockDelta: Row | null = null;
    if (product.serialized) {
      const serials = input.serialNumbers ?? [];
      const candidates = data.units.filter(
        (u) =>
          u.productId === product.id &&
          u.status === 'in_stock' &&
          u.locationId === input.fromLocationId &&
          (input.fromBinId === undefined || u.binId === input.fromBinId),
      );
      let toMove = input.quantity;
      for (const unit of candidates) {
        if (toMove <= 0) break;
        if (serials.length > 0 && !serials.includes(unit.serialNumber)) continue;
        unitIds.push(unit.id);
        toMove--;
      }
      if (toMove > 0) {
        throw new Error(
          `Only ${input.quantity - toMove} of ${input.quantity} unit(s) available at the source.`,
        );
      }
    } else {
      // Verify the *source bin* actually holds enough before crediting the
      // destination — validateTransfer only checks the location total, so a move
      // out of an empty bin would otherwise duplicate stock.
      const fromLevel = data.stockLevels.find(
        (s) =>
          s.productId === product.id &&
          s.locationId === input.fromLocationId &&
          (s.binId ?? undefined) === (input.fromBinId ?? undefined),
      );
      if (!fromLevel || fromLevel.quantity < input.quantity) {
        throw new Error(
          `Insufficient stock in the selected source bin to transfer ${input.quantity}.`,
        );
      }
      fromStockDelta = {
        product_id: product.id,
        location_id: input.fromLocationId,
        bin_id: input.fromBinId ?? null,
        delta: -input.quantity,
      };
      toStockDelta = {
        product_id: product.id,
        location_id: input.toLocationId,
        bin_id: input.toBinId ?? null,
        delta: input.quantity,
      };
    }

    const movement: Movement = {
      id: uid('mv'),
      type: 'transfer',
      productId: product.id,
      quantity: input.quantity,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      fromBinId: input.fromBinId,
      toBinId: input.toBinId,
      actor: input.actor,
      createdAt,
    };
    const row = await this.callRpc('transfer', {
      unit_ids: unitIds,
      from_location_id: input.fromLocationId,
      to_location_id: input.toLocationId,
      to_bin_id: input.toBinId ?? null,
      from_stock_delta: fromStockDelta,
      to_stock_delta: toStockDelta,
      movement: movementToRow(movement),
    });
    return [rowToMovement(row)];
  }

  async createPurchaseOrder(
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrder> {
    const po: PurchaseOrder = {
      id: uid('po'),
      supplierId: input.supplierId,
      status: 'ordered',
      lines: input.lines.map((l) => ({
        productId: l.productId,
        quantityOrdered: l.quantityOrdered,
        quantityReceived: 0,
      })),
      expectedDate: input.expectedDate,
      actor: input.actor,
      createdAt: new Date().toISOString(),
    };
    await this.callRpc('create_purchase_order', {
      purchase_order: poToRow(po),
    });
    return po;
  }

  async receiveAgainstPO(input: ReceiveAgainstPOInput): Promise<PurchaseOrder> {
    const data = await this.getData();
    const po = data.purchaseOrders.find((p) => p.id === input.poId);
    if (!po) throw new Error('Purchase order not found.');
    if (po.status === 'cancelled')
      throw new Error('Cannot receive against a cancelled purchase order.');
    const createdAt = new Date().toISOString();

    const units: Row[] = [];
    const movements: Row[] = [];
    const stockByKey = new Map<string, Row>();
    // Client-side projection of lines after this receipt — used only to
    // estimate the next PO status. The RPC accumulates received quantities
    // server-side into the stored lines JSON, so concurrent receives can't
    // overwrite each other.
    const projectedLines = po.lines.map((l) => ({ ...l }));

    for (const line of input.lines) {
      if (line.quantityReceived <= 0) continue;
      const product = data.products.find((p) => p.id === line.productId);
      if (!product) throw new Error(`Unknown product: ${line.productId}`);

      const poLine = projectedLines.find((l) => l.productId === line.productId);
      if (!poLine)
        throw new Error(`Received product is not on this PO: ${line.productId}`);
      poLine.quantityReceived = Math.min(
        poLine.quantityOrdered,
        poLine.quantityReceived + line.quantityReceived,
      );

      if (product.serialized) {
        for (let i = 0; i < line.quantityReceived; i++) {
          units.push(
            unitToRow({
              id: uid('unit'),
              productId: product.id,
              serialNumber: `${product.sku}-SN${Date.now()}${i}`,
              locationId: input.locationId,
              binId: input.binId,
              status: 'in_stock',
            }),
          );
        }
      } else {
        const key = `${product.id}|${input.locationId}|${input.binId ?? ''}`;
        let entry = stockByKey.get(key);
        if (!entry) {
          entry = {
            product_id: product.id,
            location_id: input.locationId,
            bin_id: input.binId ?? null,
            lot_id: null,
            delta: 0,
          };
          stockByKey.set(key, entry);
        }
        entry.delta = (entry.delta as number) + line.quantityReceived;
      }

      movements.push(
        movementToRow({
          id: uid('mv'),
          type: 'receipt',
          productId: product.id,
          quantity: line.quantityReceived,
          toLocationId: input.locationId,
          toBinId: input.binId,
          reference: po.id,
          actor: input.actor,
          createdAt,
        }),
      );
    }

    const status = poStatusAfterReceipt({ ...po, lines: projectedLines });
    const row = await this.callRpc('receive_against_po', {
      units,
      stock_deltas: [...stockByKey.values()],
      movements,
      po_id: po.id,
      po_status: status,
      line_deltas: input.lines.filter((l) => l.quantityReceived > 0),
    });
    return rowToPurchaseOrder(row);
  }

  async cancelPurchaseOrder(
    input: CancelPurchaseOrderInput,
  ): Promise<PurchaseOrder> {
    const data = await this.getData();
    const po = data.purchaseOrders.find((p) => p.id === input.poId);
    if (!po) throw new Error('Purchase order not found.');
    if (po.status === 'received')
      throw new Error('Cannot cancel a fully received purchase order.');
    if (po.status === 'cancelled')
      throw new Error('Purchase order already cancelled.');
    await this.callRpc('cancel_purchase_order', { po_id: po.id });
    return { ...po, status: 'cancelled' };
  }

  async createEvent(input: CreateEventInput): Promise<WarehouseEvent> {
    const event: WarehouseEvent = {
      id: uid('evt'),
      name: input.name,
      type: input.type,
      siteLocationId: input.siteLocationId,
      startDate: input.startDate,
      endDate: input.endDate,
    };
    const row = await this.callRpc('create_event', { event: eventToRow(event) });
    return rowToEvent(row);
  }

  async cancelAllocation(input: CancelAllocationInput): Promise<Allocation> {
    const data = await this.getData();
    const allocation = data.allocations.find((a) => a.id === input.allocationId);
    if (!allocation) throw new Error('Allocation not found.');
    if (allocation.status === 'issued')
      throw new Error('Cannot cancel an issued allocation.');

    const row = await this.callRpc('cancel_allocation', {
      allocation_id: allocation.id,
    });
    return rowToAllocation(row);
  }

  async createSupplier(input: CreateSupplierInput): Promise<Supplier> {
    if (!input.name.trim()) throw new Error('Supplier name is required.');
    const supplier: Supplier = {
      id: uid('sup'),
      name: input.name.trim(),
      leadTimeDays: input.leadTimeDays,
    };
    const { error } = await this.db
      .from('suppliers')
      .insert(supplierToRow(supplier));
    if (error) throw new Error(error.message);
    return supplier;
  }

  async updateSupplier(input: UpdateSupplierInput): Promise<Supplier> {
    if (!input.name.trim()) throw new Error('Supplier name is required.');
    const supplier: Supplier = {
      id: input.supplierId,
      name: input.name.trim(),
      leadTimeDays: input.leadTimeDays,
    };
    const { data, error } = await this.db
      .from('suppliers')
      .update(supplierToRow(supplier))
      .eq('id', input.supplierId)
      .select(TABLE_PROJECTIONS.suppliers)
      .single();
    if (error) throw new Error(error.message);
    return rowToSupplier(data as never);
  }

  async createLocation(input: CreateLocationInput): Promise<Location> {
    if (!input.name.trim()) throw new Error('Location name is required.');
    const id = input.id?.trim() || uid('loc');
    const row = { id, name: input.name.trim(), type: input.type };
    const { data, error } = await this.db
      .from('locations')
      .insert(row)
      .select(TABLE_PROJECTIONS.locations)
      .single();
    if (error) throw new Error(error.message);
    return rowToLocation(data as never);
  }

  async updateLocation(input: UpdateLocationInput): Promise<Location> {
    if (!input.name.trim()) throw new Error('Location name is required.');
    const { data, error } = await this.db
      .from('locations')
      .update({ name: input.name.trim(), type: input.type })
      .eq('id', input.locationId)
      .select(TABLE_PROJECTIONS.locations)
      .single();
    if (error) throw new Error(error.message);
    return rowToLocation(data as never);
  }

  async deleteLocation(input: { locationId: string }): Promise<void> {
    // Guard against orphaning stock. The DB trigger enforces this too, but a
    // client-side check gives a clearer message before the round-trip.
    const [{ data: levels }, { data: units }] = await Promise.all([
      this.db
        .from('stock_levels')
        .select('quantity')
        .eq('location_id', input.locationId)
        .gt('quantity', 0)
        .limit(1),
      this.db
        .from('inventory_units')
        .select('id')
        .eq('location_id', input.locationId)
        .eq('status', 'in_stock')
        .limit(1),
    ]);
    if ((levels?.length ?? 0) > 0 || (units?.length ?? 0) > 0) {
      throw new Error(
        'Cannot delete a location that still holds stock. Transfer or write off its stock first.',
      );
    }
    const { error } = await this.db
      .from('locations')
      .delete()
      .eq('id', input.locationId);
    if (error) throw new Error(error.message);
  }

  async setProductPrice(input: SetProductPriceInput): Promise<Product> {
    if (Number.isNaN(input.price) || input.price < 0)
      throw new Error('Price must be zero or more.');
    const row = await this.callRpc('set_product_price', {
      product_id: input.productId,
      price: input.price,
    });
    return rowToProduct(row);
  }

  async createProduct(input: CreateProductInput): Promise<Product> {
    const data = await this.getData();
    const product = buildNewProduct(uid('prod'), input, data.products);
    const { error } = await this.db
      .from('products')
      .insert(productToRow(product));
    if (error) throw new Error(error.message);
    return product;
  }

  async updateProduct(input: UpdateProductInput): Promise<Product> {
    const data = await this.getData();
    const current = data.products.find((p) => p.id === input.productId);
    if (!current) throw new Error('Product not found.');
    // Validate + compute the next product, then persist the changed columns.
    const next = applyProductPatch(current, input.patch);
    const { data: row, error } = await this.db
      .from('products')
      .update(productToRow(next))
      .eq('id', input.productId)
      .select(TABLE_PROJECTIONS.products)
      .single();
    if (error) throw new Error(error.message);
    return rowToProduct(row as never);
  }

  async adjustStock(input: AdjustStockInput): Promise<Movement> {
    const data = await this.getData();
    const product = data.products.find((p) => p.id === input.productId);
    if (!product) throw new Error('Product not found.');
    if (!input.reason.trim()) throw new Error('A reason is required.');
    const createdAt = new Date().toISOString();

    const unitIds: string[] = [];
    let stockDelta: Row | null = null;
    if (product.serialized) {
      if (input.quantityDelta > 0) {
        throw new Error(
          'Found serialized units must be received/registered individually, not added by quantity.',
        );
      }
      if (input.quantityDelta < 0) {
        let toRemove = -input.quantityDelta;
        const candidates = data.units.filter(
          (u) =>
            u.productId === product.id &&
            u.status === 'in_stock' &&
            u.locationId === input.locationId &&
            (input.binId === undefined || u.binId === input.binId),
        );
        for (const unit of candidates) {
          if (toRemove <= 0) break;
          unitIds.push(unit.id);
          toRemove--;
        }
      }
    } else if (input.quantityDelta !== 0) {
      stockDelta = {
        product_id: product.id,
        location_id: input.locationId,
        bin_id: input.binId ?? null,
        delta: input.quantityDelta,
      };
    }

    const movement: Movement = {
      id: uid('mv'),
      type: 'adjustment',
      productId: product.id,
      quantity: input.quantityDelta,
      toLocationId: input.locationId,
      toBinId: input.binId,
      reason: input.reason,
      actor: input.actor,
      createdAt,
    };
    const row = await this.callRpc('adjust_stock', {
      unit_ids: unitIds,
      stock_delta: stockDelta,
      movement: movementToRow(movement),
    });
    return rowToMovement(row);
  }

  async createStorageArea(input: CreateStorageAreaInput): Promise<StorageArea> {
    if (!input.code.trim()) throw new Error('A bin code is required.');
    const area: StorageArea = {
      id: input.id?.trim() || uid('bin'),
      locationId: input.locationId,
      code: input.code.trim(),
      label: input.label?.trim() || undefined,
      zone: input.zone?.trim() || undefined,
      active: true,
    };
    const row = await this.callRpc('create_storage_area', {
      storage_area: storageAreaToRow(area),
    });
    return rowToStorageArea(row);
  }

  async updateStorageArea(input: UpdateStorageAreaInput): Promise<StorageArea> {
    if (!input.code.trim()) throw new Error('A bin code is required.');
    const patch: Row = {
      code: input.code.trim(),
      label: input.label?.trim() || null,
      zone: input.zone?.trim() || null,
    };
    if (input.active !== undefined) patch.active = input.active;
    const row = await this.callRpc('update_storage_area', {
      storage_area_id: input.storageAreaId,
      patch,
    });
    return rowToStorageArea(row);
  }

  async deleteStorageArea(input: { storageAreaId: string }): Promise<void> {
    // Atomic + capability-checked: the RPC deletes the bin and the FK
    // (on delete set null) detaches it from any stock/units in one transaction.
    await this.callRpc('delete_storage_area', {
      storage_area_id: input.storageAreaId,
    });
  }

  async relocate(input: RelocateInput): Promise<Movement[]> {
    if (input.quantity <= 0) throw new Error('Quantity must be greater than zero.');
    if ((input.fromBinId ?? undefined) === (input.toBinId ?? undefined)) {
      throw new Error('Source and destination bins must differ.');
    }
    const data = await this.getData();
    const product = data.products.find((p) => p.id === input.productId);
    if (!product) throw new Error('Product not found.');
    const createdAt = new Date().toISOString();

    const unitIds: string[] = [];
    let fromStockDelta: Row | null = null;
    let toStockDelta: Row | null = null;
    if (product.serialized) {
      const serials = input.serialNumbers ?? [];
      const candidates = data.units.filter(
        (u) =>
          u.productId === product.id &&
          u.status === 'in_stock' &&
          u.locationId === input.locationId &&
          (u.binId ?? undefined) === (input.fromBinId ?? undefined),
      );
      let toMove = input.quantity;
      for (const unit of candidates) {
        if (toMove <= 0) break;
        if (serials.length > 0 && !serials.includes(unit.serialNumber)) continue;
        unitIds.push(unit.id);
        toMove--;
      }
      if (toMove > 0) {
        throw new Error(
          `Only ${input.quantity - toMove} of ${input.quantity} unit(s) available in the source bin.`,
        );
      }
    } else {
      // Confirm the source bin can cover the move before crediting the target.
      const fromLevel = data.stockLevels.find(
        (s) =>
          s.productId === product.id &&
          s.locationId === input.locationId &&
          (s.binId ?? undefined) === (input.fromBinId ?? undefined),
      );
      if (!fromLevel || fromLevel.quantity < input.quantity) {
        throw new Error(
          `Insufficient stock in the source bin to move ${input.quantity}.`,
        );
      }
      fromStockDelta = {
        product_id: product.id,
        location_id: input.locationId,
        bin_id: input.fromBinId ?? null,
        delta: -input.quantity,
      };
      toStockDelta = {
        product_id: product.id,
        location_id: input.locationId,
        bin_id: input.toBinId ?? null,
        delta: input.quantity,
      };
    }

    const movement: Movement = {
      id: uid('mv'),
      type: 'transfer',
      productId: product.id,
      quantity: input.quantity,
      fromLocationId: input.locationId,
      toLocationId: input.locationId,
      fromBinId: input.fromBinId,
      toBinId: input.toBinId,
      reason: 'bin relocation',
      actor: input.actor,
      createdAt,
    };
    const row = await this.callRpc('transfer', {
      unit_ids: unitIds,
      from_location_id: input.locationId,
      to_location_id: input.locationId,
      to_bin_id: input.toBinId ?? null,
      from_stock_delta: fromStockDelta,
      to_stock_delta: toStockDelta,
      movement: movementToRow(movement),
    });
    return [rowToMovement(row)];
  }
}

/** Factory shape compatible with createRepository (spec ADR-003 seam). */
export function createSupabaseWarehouseRepository(
  client: import('@supabase/supabase-js').SupabaseClient<any, any>,
): WarehouseControlRepository {
  return new SupabaseRepository(
    client.schema('warehouse') as unknown as import('@supabase/supabase-js').SupabaseClient,
  );
}

