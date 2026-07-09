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
  };
  const client = {
    from: (table: string) => ({
      select: () => Promise.resolve({ data: tables[table] ?? [], error: null }),
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
      return Promise.resolve({ data: row, error: null });
    },
  };
  return { client: client as never, calls };
}

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

  it('recordCycleCount sends absolute stock_sets + variance movements', async () => {
    const { client, calls } = makeMockClient(seed);
    const repo = new SupabaseRepository(client);
    await repo.recordCycleCount({
      locationId: 'loc-wh',
      lines: [{ productId: token.id, expected: 80, counted: 75 }],
      actor: 'test',
    });
    const call = calls.find((c) => c.fn === 'record_cycle_count')!;
    const sets = call.payload.stock_sets as { quantity: number }[];
    expect(sets).toHaveLength(1);
    // Cycle count SETS the counted quantity (absolute), unlike other mutations.
    expect(sets[0]!.quantity).toBe(75);
    const movements = call.payload.movements as { quantity: number }[];
    expect(movements[0]!.quantity).toBe(-5);
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
});
