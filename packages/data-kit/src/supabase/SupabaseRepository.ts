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
  returnClosesAllocation,
  validateReservation,
} from '../domain/allocations';
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
  type WarehouseRepository,
} from '../repository';
import {
  allocationToRow,
  eventToRow,
  lotToRow,
  movementToRow,
  poToRow,
  productToRow,
  rowToAllocation,
  rowToCycleCount,
  rowToEvent,
  rowToLocation,
  rowToLot,
  rowToMovement,
  rowToProduct,
  rowToProfile,
  rowToPurchaseOrder,
  rowToReceipt,
  rowToReturn,
  rowToStockLevel,
  rowToStorageArea,
  rowToSupplier,
  rowToUnit,
  storageAreaToRow,
  supplierToRow,
  unitToRow,
} from './mappers';

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Snake-case row shape passed to / returned from the SQL layer. */
type Row = Record<string, unknown>;

/**
 * Supabase-backed repository. Mutations mirror the in-memory adapter's logic
 * but persist to Postgres via SECURITY DEFINER RPCs in the `warehouse` schema.
 * Reads hydrate the full warehouse read model from the same schema.
 *
 * ---------------------------------------------------------------------------
 * RBAC REWIRE (spec §4.2 / ADR-004 / monorepo migration `20260706092400`)
 * ---------------------------------------------------------------------------
 * The RPCs still live in `warehouse.*` and the payload envelope is unchanged
 * (`.rpc(fn, { payload })`) — but the capability gate inside every RPC now
 * reads `core.has_cap('warehouse', '<cap>')` against `core.user_roles` +
 * `core.role_capabilities`. The client is agnostic to this: it invokes the
 * same RPCs with the same payload shapes and any authorization failure comes
 * back as a normal RPC error. Nothing here changes.
 *
 * ---------------------------------------------------------------------------
 * CLIENT INJECTION (spec §12 step 2)
 * ---------------------------------------------------------------------------
 * The source file constructed the client from `import.meta.env`. Inside
 * `@intra/data-kit` the client is INJECTED via the constructor so the package
 * runs under Next.js / Vite / Node / edge without a build-tool global. The
 * host app owns env and client construction (schema must be `warehouse`).
 */
export class SupabaseRepository implements WarehouseRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async select<T>(table: string, map: (r: never) => T): Promise<T[]> {
    const { data, error } = await this.db.from(table).select('*');
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []).map((r) => map(r as never));
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
    };
  }

  async getStockState() {
    return toStockState(await this.getData());
  }

  async getProfiles() {
    return this.select('profiles', rowToProfile);
  }

  /**
   * Invokes a transactional Postgres RPC (see the `warehouse_rpcs` migration).
   * The whole multi-step mutation commits or rolls back atomically, so a
   * mid-operation failure can never leave stock / units / movements /
   * documents out of sync. Returns the primary row the function emits.
   *
   * RBAC: the RPCs open with `core.has_cap('warehouse', '<cap>')` — no
   * warehouse-local RBAC table is consulted. See class-level docs.
   */
  private async callRpc(
    fn: string,
    payload: Record<string, unknown>,
  ): Promise<Row> {
    const { data, error } = await this.db.rpc(fn, { payload });
    if (error) throw new Error(error.message);
    return data as Row;
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
      if (line.unitCost != null || line.lotCode) {
        const lot: Lot = {
          id: uid('lot'),
          productId: product.id,
          lotCode: line.lotCode ?? `LOT-${product.sku}-${Date.now()}`,
          supplierId: input.supplierId,
          unitCost: line.unitCost ?? product.unitCost,
          receivedAt: createdAt,
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
    // re-validates ATP inside its transaction (with a per-product advisory
    // lock) so concurrent reservations can't both pass against a stale
    // snapshot.
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
    const data = await this.getData();
    const count: CycleCount = {
      id: uid('cc'),
      locationId: input.locationId,
      binId: input.binId,
      category: input.category,
      lines: input.lines,
      actor: input.actor,
      createdAt,
    };

    const stockUpdates: Row[] = [];
    const movements: Row[] = [];
    for (const line of input.lines) {
      const variance = line.counted - line.expected;
      if (variance === 0) continue;
      const product = data.products.find((p) => p.id === line.productId);
      if (product && !product.serialized) {
        stockUpdates.push({
          product_id: product.id,
          location_id: input.locationId,
          bin_id: input.binId ?? null,
          quantity: line.counted,
        });
      }
      movements.push(
        movementToRow({
          id: uid('mv'),
          type: 'cycle_count',
          productId: line.productId,
          quantity: variance,
          toLocationId: input.locationId,
          toBinId: input.binId,
          reference: count.id,
          reason: 'cycle count adjustment',
          actor: input.actor,
          createdAt,
        }),
      );
    }

    const row = await this.callRpc('record_cycle_count', {
      stock_sets: stockUpdates,
      movements,
      cycle_count: {
        id: count.id,
        location_id: count.locationId,
        bin_id: count.binId ?? null,
        category: count.category ?? null,
        lines: count.lines,
        actor: count.actor,
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
    // Server stamps status='ordered' and origin='warehouse' (ADR-002 #2); we
    // still send the full row so the RPC can INSERT via jsonb_populate_record.
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
    const { error } = await this.db.from('events').insert(eventToRow(event));
    if (error) throw new Error(error.message);
    return event;
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
      .select('*')
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
      .select('*')
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
      .select('*')
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
      .select('*')
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
    const { data, error } = await this.db
      .from('storage_areas')
      .insert(storageAreaToRow(area))
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return rowToStorageArea(data as never);
  }

  async updateStorageArea(input: UpdateStorageAreaInput): Promise<StorageArea> {
    if (!input.code.trim()) throw new Error('A bin code is required.');
    const patch: Row = {
      code: input.code.trim(),
      label: input.label?.trim() || null,
      zone: input.zone?.trim() || null,
    };
    if (input.active !== undefined) patch.active = input.active;
    const { data, error } = await this.db
      .from('storage_areas')
      .update(patch)
      .eq('id', input.storageAreaId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return rowToStorageArea(data as never);
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

/**
 * Factory for the injected Supabase adapter (see `createRepository.ts`). The
 * warehouse module (or Next.js host) constructs a `SupabaseClient` — typically
 * from `@intra/auth` — and hands it to `createRepository` via `supabaseClient`
 * or directly here. Keeping this a plain function makes the adapter trivial to
 * mock in tests.
 */
export function createSupabaseWarehouseRepository(
  client: SupabaseClient,
): WarehouseRepository {
  return new SupabaseRepository(client);
}
