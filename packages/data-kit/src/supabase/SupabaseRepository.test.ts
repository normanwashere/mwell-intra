import { describe, it, expect } from 'vitest';
import { SupabaseRepository } from './SupabaseRepository';
import type { WarehouseData } from '../repository';
import { buildSeed } from '../seed';
import {
  productToRow,
  lotToRow,
  unitToRow,
  movementToRow,
  allocationToRow,
  eventToRow,
  supplierToRow,
} from './mappers';

// Minimal mock: records rpc() calls and returns a row the mappers can read.
// Table rows are returned in the snake_case shape the rowTo* mappers expect.
//
// Adaptation notes (spec §12 step 2):
//   * ported from `mwell-intra-warehouse/src/data/supabase/supabaseRepository.test.ts`
//   * imports the adapter from its new home (`./SupabaseRepository`) and the
//     seed / repository from the runtime-agnostic package root (no `@/` alias).
//   * the RPC gate now lives at `core.has_cap('warehouse', <cap>')`, but the
//     wire payload envelope is identical — these assertions stay valid.
function makeMockClient(seed: WarehouseData) {
  const calls: { fn: string; payload: Record<string, unknown> }[] = [];
  const queries: { table: string; projection: string; limit?: number; orders: string[] }[] = [];
  const locationRows = seed.locations.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
  }));
  const storageAreaRows = seed.storageAreas.map((a) => ({
    id: a.id,
    location_id: a.locationId,
    code: a.code,
    label: a.label ?? null,
    zone: a.zone ?? null,
    active: a.active ?? true,
  }));
  const stockRows = seed.stockLevels.map((s) => ({
    product_id: s.productId,
    location_id: s.locationId,
    bin_id: s.binId ?? null,
    lot_id: s.lotId ?? null,
    quantity: s.quantity,
  }));
  const returnRows = seed.returns.map((r) => ({
    id: r.id,
    source: r.source,
    event_id: r.eventId ?? null,
    lines: r.lines,
    evidence_urls: r.evidenceUrls ?? [],
    actor: r.actor,
    created_at: r.createdAt,
  }));
  const ccRows = seed.cycleCounts.map((c) => ({
    id: c.id,
    location_id: c.locationId,
    bin_id: c.binId ?? null,
    category: c.category ?? null,
    lines: c.lines,
    actor: c.actor,
    created_at: c.createdAt,
  }));
  const receiptRows = seed.receipts.map((r) => ({
    id: r.id,
    supplier_id: r.supplierId ?? null,
    location_id: r.locationId,
    lines: r.lines,
    evidence_urls: r.evidenceUrls ?? [],
    actor: r.actor,
    created_at: r.createdAt,
  }));
  const poRows = seed.purchaseOrders.map((p) => ({
    id: p.id,
    supplier_id: p.supplierId,
    status: p.status,
    lines: p.lines,
    expected_date: p.expectedDate ?? null,
    actor: p.actor,
    created_at: p.createdAt,
  }));
  const tables: Record<string, unknown[]> = {
    products: seed.products.map(productToRow),
    locations: locationRows,
    storage_areas: storageAreaRows,
    suppliers: seed.suppliers.map(supplierToRow),
    lots: seed.lots.map(lotToRow),
    inventory_units: seed.units.map(unitToRow),
    stock_levels: stockRows,
    movements: seed.movements.map(movementToRow),
    allocations: seed.allocations.map(allocationToRow),
    events: seed.events.map(eventToRow),
    returns: returnRows,
    cycle_counts: ccRows,
    receipts: receiptRows,
    purchase_orders: poRows,
    profiles: [],
    operation_types: [],
    operation_routes: [],
    quality_inspections: [{
      id: 'qi-1', source_type: 'receipt', source_id: 'rcpt-1', product_id: 'shirt',
      bin_id: null, lot_id: null, serial_number: null, quantity: 1,
      disposition: 'accepted', reason: null, evidence_urls: [], inspected_by: 'user-1',
      inspected_at: '2026-07-10T00:00:00Z',
    }],
    inventory_holds: [{
      id: 'hold-1', inspection_id: 'qi-1', product_id: 'shirt', location_id: 'loc-wh',
      bin_id: null, lot_id: null, serial_number: null, quantity: 1, status: 'active',
      reason: 'Damage', created_by: 'user-1', created_at: '2026-07-10T00:00:00Z',
      released_by: null, released_at: null,
    }],
    vendor_returns: [{
      id: 'vr-1', hold_id: 'hold-1', supplier_id: 'sup-1', source_receipt_id: 'rcpt-1',
      source_return_id: null, product_id: 'shirt', lot_id: null, serial_number: null,
      quantity: 1, reason: 'Rejected', reference: 'RMA-001', status: 'ready',
      evidence_urls: [], created_by: 'user-2', created_at: '2026-07-10T00:00:00Z',
      handed_off_by: null, handed_off_at: null, completed_at: null,
    }],
    exceptions: [{
      id: 'ex-1', exception_type: 'quality', severity: 'P2', source_type: 'quality_inspection',
      source_id: 'qi-1', status: 'open', owner_id: null, due_at: null, resolution: null,
      created_at: '2026-07-10T00:00:00Z',
    }],
    stock_change_requests: [{
      id: 'scr-1', source_type: 'cycle_count', source_id: 'cc-1', product_id: 'shirt',
      location_id: 'loc-wh', bin_id: null, quantity_delta: -1, unit_cost: 200,
      financial_impact: 200, reason: 'Variance', evidence_urls: [],
      status: 'pending_supervisor', requested_by: 'user-1', requested_at: '2026-07-10T00:00:00Z',
    }],
    warehouse_tasks: [{
      id: 'task-1', task_type: 'quality', source_id: 'qi-1', title: 'Inspect receipt',
      status: 'due', assignee_id: null, due_at: null, completed_at: null,
      created_at: '2026-07-10T00:00:00Z',
    }],
    inventory_position_v1: [{
      id: 'shirt|loc-wh|', product_id: 'shirt', location_id: 'loc-wh', bin_id: null,
      on_hand: 20, committed: 1, held: 1, unavailable: 0, available: 18,
      created_at: '2026-07-10T00:00:00Z',
    }],
    procurement_po_handoff: [{
      id: 'live-po-1', po_number: 'PO-LIVE-001', vendor_name: 'Live Vendor',
      status: 'issued', expected_date: '2026-07-20',
      lines: [{ id: 'line-1', productId: 'shirt', description: 'Shirts', quantity: 5, receivedQuantity: 1 }],
    }],
  };
  const client = {
    from: (table: string) => ({
      select: (projection: string) => {
        const record = { table, projection, orders: [] } as {
          table: string; projection: string; limit?: number; orders: string[];
        };
        queries.push(record);
        const result = Promise.resolve({ data: tables[table] ?? [], error: null });
        const query = {
          order: (column: string) => {
            record.orders.push(column);
            return query;
          },
          or: () => query,
          eq: () => query,
          limit: (limit: number) => {
            record.limit = limit;
            return query;
          },
          then: result.then.bind(result),
        };
        return query;
      },
      insert: () => Promise.resolve({ data: null, error: null }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    }),
    rpc: (fn: string, args: { payload: Record<string, unknown> }) => {
      calls.push({ fn, payload: args.payload });
      const row: Record<string, unknown> = {
        id: 'mock',
        product_id: 'mock-product',
        location_id: 'loc-wh',
        supplier_id: null,
        event_id: 'evt-makati',
        status: 'issued',
        quantity: 1,
        type: 'movement',
        actor: 'test',
        created_at: new Date().toISOString(),
        lines: [],
        evidence_urls: [],
        source: 'customer',
        category: null,
        serial_number: null,
        from_location_id: null,
        to_location_id: null,
        lot_id: null,
        code: 'BIN-MOCK',
        label: null,
        zone: null,
        active: true,
        reason: null,
        reference: null,
        sku: 'MOCK',
        name: 'Mock',
        serialized: false,
        attributes: {},
        unit_cost: 0,
        reorder_point: 0,
        promotional: false,
        barcode: null,
        price: null,
        device_type: null,
        merchandise_type: null,
        lead_time_days: 0,
        site_location_id: null,
        start_date: '2026-01-01',
        end_date: null,
        expected_date: null,
        email: 't@t',
        role: 'logistics_supervisor',
        title: 't',
        lot_code: null,
        received_at: null,
        assigned_to: null,
      };
      const quality = tables.quality_inspections![0] as Record<string, unknown>;
      const hold = tables.inventory_holds![0] as Record<string, unknown>;
      const exception = tables.exceptions![0] as Record<string, unknown>;
      const request = tables.stock_change_requests![0] as Record<string, unknown>;
      const route = {
        id: 'route-1', operation_type_id: 'op-1', source_location_types: ['vendor'],
        destination_location_types: ['warehouse'], requires_evidence: true,
        requires_approval: false, requires_online: true, active: true,
      };
      const response = fn === 'inspect_quality' ? { inspection: quality }
        : fn === 'release_quality_hold' ? hold
          : fn === 'update_operation_route' ? route
            : fn === 'submit_cycle_count' ? { cycle_count: row, requests: [request] }
              : fn === 'decide_stock_change' ? request
                : fn === 'resolve_exception' ? exception
                  : fn === 'receive_procurement_po' ? { receipt: row, purchase_order: {} }
                  : row;
      return Promise.resolve({ data: response, error: null });
    },
  };
  return { client: client as never, calls, queries };
}

describe('SupabaseRepository read model query shape', () => {
  it('uses explicit projections and bounds operational history', async () => {
    const { client, queries } = makeMockClient(buildSeed());
    await new SupabaseRepository(client).getData();
    expect(queries).toHaveLength(16);
    expect(queries.every((query) => query.projection !== '*')).toBe(true);
    expect(queries.find((query) => query.table === 'movements')?.limit).toBe(5000);
    expect(queries.find((query) => query.table === 'products')?.limit).toBeUndefined();
  });
});

describe('SupabaseRepository W1 control boundary', () => {
  it('uses explicit projections and stable bounded pagination for every control list', async () => {
    const { client, queries } = makeMockClient(buildSeed());
    const repo = new SupabaseRepository(client);
    await Promise.all([
      repo.listQualityInspections({ limit: 500 }),
      repo.listHolds({ limit: 500 }),
      repo.listVendorReturns({ limit: 500 }),
      repo.listExceptions({ limit: 500 }),
      repo.listStockChangeRequests({ limit: 500 }),
      repo.listWarehouseTasks({ limit: 500 }),
      repo.listInventoryPositions({ limit: 500 }),
    ]);
    const controlTables = [
      'quality_inspections', 'inventory_holds', 'vendor_returns', 'exceptions',
      'stock_change_requests', 'warehouse_tasks', 'inventory_position_v1',
    ];
    for (const table of controlTables) {
      const query = queries.find((item) => item.table === table)!;
      expect(query.projection).not.toBe('*');
      expect(query.orders).toEqual([
        table === 'quality_inspections' ? 'inspected_at' : 'created_at',
        'id',
      ]);
      expect(query.limit).toBe(101);
    }
    const qualityQuery = queries.find((item) => item.table === 'quality_inspections')!;
    expect(qualityQuery.projection).toContain('inspected_at');
    expect(qualityQuery.projection).not.toContain('created_at');
  });

  it('sends idempotent command payloads without trusted actor or role values', async () => {
    const { client, calls } = makeMockClient(buildSeed());
    const repo = new SupabaseRepository(client);
    await repo.inspectQuality({
      idempotencyKey: 'quality-key-0001', sourceType: 'receipt', sourceId: 'rcpt-1',
      productId: 'shirt', quantity: 1, disposition: 'accepted',
    });
    await repo.releaseHold({
      idempotencyKey: 'release-key-0001', holdId: 'hold-1', targetDisposition: 'accepted',
      reason: 'QC cleared', evidenceUrls: ['evidence/release.jpg'],
    });
    await repo.updateOperationRoute({
      idempotencyKey: 'route-key-00001', routeId: 'route-1',
      patch: {
        sourceLocationTypes: ['vendor'], destinationLocationTypes: ['warehouse'],
        requiresEvidence: true, requiresApproval: false, requiresOnline: true, active: true,
      },
    });
    await repo.submitCycleCount({
      idempotencyKey: 'count-key-00001', cycleCountId: 'cc-1', reason: 'Scheduled count',
    });
    await repo.decideStockChange({
      idempotencyKey: 'decision-key-01', requestId: 'scr-1', decision: 'approved',
    });
    await repo.resolveException({
      idempotencyKey: 'exception-key01', exceptionId: 'ex-1', action: 'begin',
    });

    for (const call of calls.slice(-6)) {
      expect(call.payload.idempotency_key).toMatch(/key/);
      expect(call.payload).not.toHaveProperty('actor');
      expect(call.payload).not.toHaveProperty('role');
    }
    expect(calls.slice(-6).map((call) => call.fn)).toEqual([
      'inspect_quality', 'release_quality_hold', 'update_operation_route',
      'submit_cycle_count', 'decide_stock_change', 'resolve_exception',
    ]);
  });

  it('receives a procurement PO through one idempotent RPC without actor claims', async () => {
    const { client, calls } = makeMockClient(buildSeed());
    const repo = new SupabaseRepository(client);
    await repo.receiveProcurementPO({
      idempotencyKey: 'procurement-receipt-01', poId: 'po-live-1',
      locationId: 'loc-wh', binId: 'bin-a',
      lines: [{ lineId: 'line-1', productId: 'shirt', quantity: 2 }],
      evidenceUrls: ['evidence/delivery.jpg'],
    });
    const call = calls.find((item) => item.fn === 'receive_procurement_po')!;
    expect(call.payload).toMatchObject({
      idempotency_key: 'procurement-receipt-01', po_id: 'po-live-1',
      location_id: 'loc-wh', bin_id: 'bin-a',
    });
    expect(call.payload).not.toHaveProperty('actor');
    expect(call.payload).not.toHaveProperty('role');
  });

  it('reads the explicit RLS-backed procurement handoff projection', async () => {
    const { client, queries } = makeMockClient(buildSeed());
    const rows = await new SupabaseRepository(client).getReceivableProcurementPOs();
    expect(rows).toEqual([expect.objectContaining({
      id: 'live-po-1', poNumber: 'PO-LIVE-001', status: 'issued',
    })]);
    const query = queries.find((item) => item.table === 'procurement_po_handoff')!;
    expect(query.projection).not.toBe('*');
    expect(query.limit).toBe(500);
  });
});

describe('SupabaseRepository concurrency-safe payloads (warehouse.* v8 RPCs)', () => {
  const seed = buildSeed();
  // Pick a non-serialized product with stock at loc-wh for delta assertions.
  const token = seed.products.find((p) => p.sku === 'TOKEN-DOC')!;

  it('issue sends stock DELTAS (negative) across bins, not an absolute quantity', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    const alloc = seed.allocations.find(
      (a) => a.productId === token.id && a.status === 'reserved',
    )!;
    await repo.issue({ allocationId: alloc.id, actor: 'test' });
    const call = calls.find((c) => c.fn === 'issue')!;
    const deltas = call.payload.stock_deltas as
      | { delta: number; product_id: string }[]
      | undefined;
    expect(deltas).toBeDefined();
    expect(deltas!.length).toBeGreaterThan(0);
    // Every delta targets the allocation product and is a negative draw-down.
    for (const d of deltas!) {
      expect(d.product_id).toBe(token.id);
      expect(d.delta).toBeLessThan(0);
    }
    // The magnitudes sum to the allocation quantity (a delta, not an absolute).
    const sum = deltas!.reduce((s, d) => s + Math.abs(d.delta), 0);
    expect(sum).toBe(alloc.quantity);
  });

  it('issue wraps its payload in the { payload } RPC envelope', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    const alloc = seed.allocations.find(
      (a) => a.productId === token.id && a.status === 'reserved',
    )!;
    await repo.issue({ allocationId: alloc.id, actor: 'test' });
    const call = calls.find((c) => c.fn === 'issue')!;
    // Envelope shape must expose the fields the SECURITY DEFINER RPC reads.
    expect(call.payload.allocation_id).toBe(alloc.id);
    expect(call.payload.movement).toBeTruthy();
    expect(call.payload).toHaveProperty('unit_ids');
  });

  it('transfer sends from/to DELTAS (negative and positive) with matching magnitudes', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.transfer({
      productId: token.id,
      fromLocationId: 'loc-wh',
      toLocationId: 'loc-cebu',
      quantity: 1,
      actor: 'test',
    });
    const call = calls.find((c) => c.fn === 'transfer')!;
    const from = call.payload.from_stock_delta as { delta: number };
    const to = call.payload.to_stock_delta as { delta: number };
    expect(from.delta).toBe(-1);
    expect(to.delta).toBe(1);
    // The SECURITY DEFINER RPC rejects mismatched magnitudes; verify parity.
    expect(Math.abs(from.delta)).toBe(Math.abs(to.delta));
  });

  it('receiveStock sends stock_deltas (positive additive), not absolute stock_levels', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.receiveStock({
      locationId: 'loc-wh',
      lines: [{ productId: token.id, quantity: 7 }],
      actor: 'test',
    });
    const call = calls.find((c) => c.fn === 'receive_stock')!;
    expect(call.payload.stock_levels).toBeUndefined();
    const deltas = call.payload.stock_deltas as { delta: number }[];
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.delta).toBe(7);
    // Receipt row uses snake_case columns so the RPC's jsonb_populate_record
    // maps straight into warehouse.receipts (evidence_urls -> core.documents).
    const receipt = call.payload.receipt as Record<string, unknown>;
    expect(receipt.location_id).toBe('loc-wh');
    expect(Array.isArray(receipt.evidence_urls)).toBe(true);
  });

  it('adjustStock sends a signed stock_delta', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.adjustStock({
      productId: token.id,
      locationId: 'loc-wh',
      quantityDelta: 3,
      reason: 'found',
      actor: 'test',
    });
    const call = calls.find((c) => c.fn === 'adjust_stock')!;
    const sd = call.payload.stock_delta as { delta: number };
    expect(sd.delta).toBe(3);
  });

  it('reserve routes through the reserve RPC (server-side ATP re-check)', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.reserve({
      eventId: 'evt-makati',
      productId: token.id,
      quantity: 1,
      actor: 'test',
    });
    const call = calls.find((c) => c.fn === 'reserve')!;
    expect(call).toBeDefined();
    // The RPC re-checks that the allocation row matches the (product, qty)
    // that ATP was evaluated against, so the client must send both sides.
    expect(call.payload.product_id).toBe(token.id);
    expect(call.payload.quantity).toBe(1);
    const alloc = call.payload.allocation as Record<string, unknown>;
    expect(alloc.product_id).toBe(token.id);
    expect(alloc.quantity).toBe(1);
    expect(alloc.status).toBe('reserved');
  });

  it('recordCycleCount creates only a governed draft', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.recordCycleCount({
      locationId: 'loc-wh',
      lines: [{ productId: token.id, expected: 80, counted: 75 }],
      actor: 'test',
    });
    const call = calls.find((c) => c.fn === 'record_cycle_count')!;
    expect(call.payload).not.toHaveProperty('stock_sets');
    expect(call.payload).not.toHaveProperty('movements');
    expect(call.payload.cycle_count).toMatchObject({
      status: 'draft',
    });
    expect(call.payload.cycle_count).not.toHaveProperty('requested_by');
    expect(call.payload.cycle_count).not.toHaveProperty('actor');
  });

  it('recordReturn accumulates restock deltas + registers evidence-carrying return row', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.recordReturn({
      source: 'customer',
      eventId: 'evt-makati',
      lines: [
        { productId: token.id, quantity: 3, reason: 'unused', disposition: 'restock' },
      ],
      evidenceUrls: ['evidence/return/abc.jpg'],
      actor: 'test',
    });
    const call = calls.find((c) => c.fn === 'record_return')!;
    const deltas = call.payload.stock_deltas as { delta: number }[];
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.delta).toBe(3);
    const ret = call.payload.return as Record<string, unknown>;
    expect(ret.event_id).toBe('evt-makati');
    expect(ret.evidence_urls).toEqual(['evidence/return/abc.jpg']);
  });

  it('createPurchaseOrder + cancelPurchaseOrder + receiveAgainstPO route through their RPCs', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.createPurchaseOrder({
      supplierId: 'sup-tokens',
      lines: [{ productId: token.id, quantityOrdered: 100 }],
      actor: 'test',
    });
    const create = calls.find((c) => c.fn === 'create_purchase_order')!;
    const po = create.payload.purchase_order as Record<string, unknown>;
    expect(po.supplier_id).toBe('sup-tokens');
    // Server stamps status='ordered' + origin='warehouse'; we still send the
    // full row for jsonb_populate_record.
    expect(po.status).toBe('ordered');

    const existingPo = seed.purchaseOrders.find(
      (p) => p.status === 'ordered' || p.status === 'partially_received',
    );
    if (existingPo) {
      await repo.receiveAgainstPO({
        poId: existingPo.id,
        locationId: 'loc-wh',
        lines: existingPo.lines.map((l) => ({
          productId: l.productId,
          quantityReceived: 1,
        })),
        actor: 'test',
      });
      const receive = calls.find((c) => c.fn === 'receive_against_po')!;
      expect(receive.payload.po_id).toBe(existingPo.id);
      // Client-projected next status feeds a hint the RPC uses only when its
      // own recomputed status agrees (server is still authoritative).
      expect(receive.payload.po_status).toBeDefined();
      // line_deltas is the additive receipt list (positive quantities only).
      const lineDeltas = receive.payload.line_deltas as {
        quantityReceived: number;
      }[];
      expect(lineDeltas.every((l) => l.quantityReceived > 0)).toBe(true);
    }

    // Cancel an ordered PO (not one already fully received).
    const cancellable = seed.purchaseOrders.find((p) => p.status === 'ordered');
    if (cancellable) {
      await repo.cancelPurchaseOrder({ poId: cancellable.id, actor: 'test' });
      const cancel = calls.find((c) => c.fn === 'cancel_purchase_order')!;
      expect(cancel.payload.po_id).toBe(cancellable.id);
    }
  });

  it('cancelAllocation routes through the cancel_allocation RPC', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    const reservable = seed.allocations.find((a) => a.status === 'reserved')!;
    await repo.cancelAllocation({
      allocationId: reservable.id,
      actor: 'test',
    });
    const call = calls.find((c) => c.fn === 'cancel_allocation')!;
    expect(call.payload.allocation_id).toBe(reservable.id);
  });

  it('setProductPrice routes through the set_product_price RPC', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.setProductPrice({
      productId: token.id,
      price: 199,
      actor: 'test',
    });
    const call = calls.find((c) => c.fn === 'set_product_price')!;
    expect(call.payload.product_id).toBe(token.id);
    expect(call.payload.price).toBe(199);
  });

  it('deleteStorageArea routes through the delete_storage_area RPC', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.deleteStorageArea({ storageAreaId: 'bin-pasig-a1' });
    const call = calls.find((c) => c.fn === 'delete_storage_area')!;
    expect(call.payload.storage_area_id).toBe('bin-pasig-a1');
  });

  it('createEvent routes through the create_event RPC', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.createEvent({
      name: 'Audit Pop-up Clinic',
      type: 'medical_mission',
      siteLocationId: 'site-makati',
      startDate: '2026-08-01',
    });
    const call = calls.find((c) => c.fn === 'create_event')!;
    expect(call).toBeDefined();
    expect((call.payload.event as Record<string, unknown>).name).toBe(
      'Audit Pop-up Clinic',
    );
  });

  it('createStorageArea and updateStorageArea route through bin RPCs', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.createStorageArea({
      locationId: 'loc-wh',
      code: 'A-99',
      label: 'Audit shelf',
      zone: 'A',
    });
    const create = calls.find((c) => c.fn === 'create_storage_area')!;
    expect(create).toBeDefined();
    expect((create.payload.storage_area as Record<string, unknown>).code).toBe('A-99');

    await repo.updateStorageArea({
      storageAreaId: 'bin-pasig-a1',
      code: 'A-01',
      label: 'Updated shelf',
      active: false,
    });
    const update = calls.find((c) => c.fn === 'update_storage_area')!;
    expect(update.payload.storage_area_id).toBe('bin-pasig-a1');
    expect((update.payload.patch as Record<string, unknown>).active).toBe(false);
  });

  it('relocate reuses the transfer RPC with same-location from/to deltas', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.relocate({
      productId: token.id,
      locationId: 'loc-wh',
      fromBinId: undefined,
      toBinId: 'bin-pasig-c1',
      quantity: 2,
      actor: 'test',
    });
    const call = calls.find((c) => c.fn === 'transfer')!;
    expect(call.payload.from_location_id).toBe('loc-wh');
    expect(call.payload.to_location_id).toBe('loc-wh');
    const from = call.payload.from_stock_delta as { delta: number };
    const to = call.payload.to_stock_delta as { delta: number };
    expect(from.delta).toBe(-2);
    expect(to.delta).toBe(2);
  });

  it('routes vendor return custody through the controlled RPC', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.createVendorReturn({
      idempotencyKey: 'vendor-return-rpc-001',
      holdId: 'hold-1',
      supplierId: 'sup-1',
      reason: 'Incoming quality rejection',
      reference: 'RMA-001',
      evidenceUrls: ['evidence/rma.jpg'],
    });
    const call = calls.find((entry) => entry.fn === 'create_vendor_return')!;
    expect(call.payload).toMatchObject({
      hold_id: 'hold-1',
      supplier_id: 'sup-1',
      reference: 'RMA-001',
    });
  });
});
