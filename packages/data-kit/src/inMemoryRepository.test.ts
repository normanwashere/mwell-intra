import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepository } from './inMemoryRepository';
import { availableForProduct } from './domain/stock';
import { uncommittedAvailable } from './domain/allocations';
import { stockByLocation } from './domain/transfers';
import { poTotalReceived } from './domain/purchaseOrders';
import { toStockState, type WarehouseData } from './repository';

function miniData(): WarehouseData {
  return {
    products: [
      {
        id: 'ring',
        sku: 'RING',
        name: 'Ring',
        category: 'device',
        deviceType: 'ecg_ring',
        serialized: true,
        attributes: {},
        unitCost: 2500,
        reorderPoint: 2,
      },
      {
        id: 'shirt',
        sku: 'SHIRT',
        name: 'Shirt',
        category: 'merchandise',
        merchandiseType: 'shirt',
        serialized: false,
        attributes: { size: 'L' },
        unitCost: 200,
        reorderPoint: 10,
      },
    ],
    locations: [
      { id: 'loc-wh', name: 'WH', type: 'warehouse' },
      { id: 'loc-cebu', name: 'Cebu', type: 'warehouse' },
    ],
    storageAreas: [
      { id: 'bin-a', locationId: 'loc-wh', code: 'WH-A-01', active: true },
      { id: 'bin-b', locationId: 'loc-wh', code: 'WH-B-01', active: true },
    ],
    suppliers: [{ id: 'sup-1', name: 'Supplier One', leadTimeDays: 7 }],
    lots: [],
    units: [
      { id: 'u1', productId: 'ring', serialNumber: 'SN1', locationId: 'loc-wh', status: 'in_stock' },
    ],
    stockLevels: [{ productId: 'shirt', locationId: 'loc-wh', quantity: 20 }],
    movements: [],
    allocations: [],
    events: [{ id: 'e1', name: 'Event', type: 'corporate', startDate: '2026-01-01' }],
    returns: [],
    cycleCounts: [],
    receipts: [],
    purchaseOrders: [],
  };
}

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository(miniData());
});

describe('receiveStock', () => {
  it('creates serialized units and increases availability', async () => {
    await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'ring', quantity: 3, serialNumbers: ['A', 'B', 'C'] }],
    });
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'ring')).toBe(4); // 1 seed + 3
    const data = await repo.getData();
    expect(data.movements.filter((m) => m.type === 'receipt')).toHaveLength(1);
  });

  it('increments non-serialized stock levels', async () => {
    await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'shirt', quantity: 30 }],
    });
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'shirt')).toBe(50);
  });

  it('creates a lot and links unit cost when supplied', async () => {
    await repo.receiveStock({
      locationId: 'loc-wh',
      supplierId: 'sup-1',
      actor: 'logi@mwell',
      lines: [{ productId: 'shirt', quantity: 10, unitCost: 225, lotCode: 'LOT-X' }],
    });
    const data = await repo.getData();
    const lot = data.lots.find((l) => l.lotCode === 'LOT-X')!;
    expect(lot).toBeDefined();
    expect(lot.unitCost).toBe(225);
    expect(lot.supplierId).toBe('sup-1');
    const mv = data.movements.find((m) => m.type === 'receipt' && m.lotId === lot.id);
    expect(mv).toBeDefined();
  });

  it('links serialized units to the captured lot', async () => {
    await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'ring', quantity: 1, serialNumbers: ['Z1'], unitCost: 2600 }],
    });
    const data = await repo.getData();
    const unit = data.units.find((u) => u.serialNumber === 'Z1')!;
    expect(unit.lotId).toBeDefined();
    const lot = data.lots.find((l) => l.id === unit.lotId)!;
    expect(lot.unitCost).toBe(2600);
  });

  it('does not create a lot when no cost/lot code is supplied', async () => {
    await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'shirt', quantity: 5 }],
    });
    const data = await repo.getData();
    expect(data.lots).toHaveLength(0);
  });

  it('records evidence URLs on the receipt and movement', async () => {
    const receipt = await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      evidenceUrls: ['blob:photo-1'],
      lines: [{ productId: 'shirt', quantity: 5 }],
    });
    expect(receipt.evidenceUrls).toEqual(['blob:photo-1']);
  });
});

describe('reserve', () => {
  it('reduces uncommitted availability', async () => {
    await repo.reserve({ eventId: 'e1', productId: 'shirt', quantity: 5, actor: 'ops@mwell' });
    const data = await repo.getData();
    const state = await repo.getStockState();
    expect(uncommittedAvailable(state, data.allocations, 'shirt')).toBe(15);
  });

  it('rejects over-reservation', async () => {
    await expect(
      repo.reserve({ eventId: 'e1', productId: 'shirt', quantity: 999, actor: 'ops@mwell' }),
    ).rejects.toThrow(/only 20 available/i);
  });
});

describe('issue', () => {
  it('marks serialized units issued and reduces availability', async () => {
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'ring', quantity: 1, actor: 'ops@mwell' });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell', assignedTo: 'Dr. X' });
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'ring')).toBe(0);
    const data = await repo.getData();
    const unit = data.units.find((u) => u.serialNumber === 'SN1')!;
    expect(unit.status).toBe('issued');
    expect(unit.assignedTo).toBe('Dr. X');
    expect(data.movements.some((m) => m.type === 'issue')).toBe(true);
  });

  it('draws non-serialized stock from the specified source location', async () => {
    // Spread shirt stock across two sites.
    await repo.transfer({
      productId: 'shirt',
      fromLocationId: 'loc-wh',
      toLocationId: 'loc-cebu',
      quantity: 8,
      actor: 'logi@mwell',
    });
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'shirt', quantity: 3, actor: 'ops@mwell' });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell', sourceLocationId: 'loc-cebu' });
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'shirt', 'loc-cebu')).toBe(5);
    expect(availableForProduct(state, 'shirt', 'loc-wh')).toBe(12);
  });

  it('records the source location on the issue movement', async () => {
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'shirt', quantity: 2, actor: 'ops@mwell' });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell', sourceLocationId: 'loc-wh' });
    const data = await repo.getData();
    const mv = data.movements.find((m) => m.type === 'issue')!;
    expect(mv.fromLocationId).toBe('loc-wh');
  });

  it('throws when issuing twice', async () => {
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'ring', quantity: 1, actor: 'ops@mwell' });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell' });
    await expect(
      repo.issue({ allocationId: alloc.id, actor: 'ops@mwell' }),
    ).rejects.toThrow(/already issued/i);
  });

  it('refuses to issue non-serialized stock from an empty source bin', async () => {
    const alloc = await repo.reserve({
      eventId: 'e1',
      productId: 'shirt',
      quantity: 2,
      actor: 'ops@mwell',
    });
    // No shirt stock exists in this fictitious bin, so the issue must fail
    // rather than silently marking the allocation issued.
    await expect(
      repo.issue({
        allocationId: alloc.id,
        actor: 'ops@mwell',
        sourceLocationId: 'loc-wh',
        sourceBinId: 'bin-does-not-exist',
      }),
    ).rejects.toThrow(/insufficient stock/i);
    const data = await repo.getData();
    expect(data.allocations.find((a) => a.id === alloc.id)?.status).toBe(
      'reserved',
    );
  });
});

describe('recordReturn', () => {
  it('restocks a serialized unit by default (back to in_stock)', async () => {
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'ring', quantity: 1, actor: 'ops@mwell' });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell' });
    await repo.recordReturn({
      source: 'customer',
      eventId: 'e1',
      actor: 'ops@mwell',
      lines: [{ productId: 'ring', quantity: 1, reason: 'unused', serialNumber: 'SN1' }],
    });
    const data = await repo.getData();
    expect(data.units.find((u) => u.serialNumber === 'SN1')!.status).toBe('in_stock');
    expect(data.returns).toHaveLength(1);
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'ring')).toBe(1);
  });

  it('closes the originating allocation when allocationId is provided', async () => {
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'ring', quantity: 1, actor: 'ops@mwell' });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell' });
    await repo.recordReturn({
      source: 'customer',
      eventId: 'e1',
      allocationId: alloc.id,
      actor: 'ops@mwell',
      lines: [{ productId: 'ring', quantity: 1, reason: 'event ended', serialNumber: 'SN1' }],
    });
    const data = await repo.getData();
    expect(data.allocations.find((a) => a.id === alloc.id)!.status).toBe('returned');
  });

  it('keeps a serialized allocation issued until every unit is returned', async () => {
    // Add a second unit so we can allocate two.
    await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'ring', quantity: 1, serialNumbers: ['SN2'] }],
    });
    const alloc = await repo.reserve({
      eventId: 'e1',
      productId: 'ring',
      quantity: 2,
      actor: 'ops@mwell',
    });
    await repo.issue({
      allocationId: alloc.id,
      actor: 'ops@mwell',
      serialNumbers: ['SN1', 'SN2'],
    });
    // Return only one unit — allocation must stay issued.
    await repo.recordReturn({
      source: 'customer',
      eventId: 'e1',
      allocationId: alloc.id,
      actor: 'ops@mwell',
      lines: [{ productId: 'ring', quantity: 1, reason: 'partial', serialNumber: 'SN1' }],
    });
    let data = await repo.getData();
    expect(data.allocations.find((a) => a.id === alloc.id)!.status).toBe('issued');
    // Return the last unit — now it closes.
    await repo.recordReturn({
      source: 'customer',
      eventId: 'e1',
      allocationId: alloc.id,
      actor: 'ops@mwell',
      lines: [{ productId: 'ring', quantity: 1, reason: 'final', serialNumber: 'SN2' }],
    });
    data = await repo.getData();
    expect(data.allocations.find((a) => a.id === alloc.id)!.status).toBe('returned');
  });

  it('leaves allocation status untouched when no allocationId is given', async () => {
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'ring', quantity: 1, actor: 'ops@mwell' });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell' });
    await repo.recordReturn({
      source: 'customer',
      eventId: 'e1',
      actor: 'ops@mwell',
      lines: [{ productId: 'ring', quantity: 1, reason: 'unused', serialNumber: 'SN1' }],
    });
    const data = await repo.getData();
    expect(data.allocations.find((a) => a.id === alloc.id)!.status).toBe('issued');
  });

  it('marks a serialized unit lost without restocking', async () => {
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'ring', quantity: 1, actor: 'ops@mwell' });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell' });
    await repo.recordReturn({
      source: 'customer',
      eventId: 'e1',
      actor: 'ops@mwell',
      lines: [{ productId: 'ring', quantity: 1, reason: 'never came back', serialNumber: 'SN1', disposition: 'lost' }],
    });
    const data = await repo.getData();
    expect(data.units.find((u) => u.serialNumber === 'SN1')!.status).toBe('lost');
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'ring')).toBe(0);
  });

  it('sends a serialized unit to vendor (status returned, not available)', async () => {
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'ring', quantity: 1, actor: 'ops@mwell' });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell' });
    await repo.recordReturn({
      source: 'vendor',
      eventId: 'e1',
      actor: 'ops@mwell',
      lines: [{ productId: 'ring', quantity: 1, reason: 'RMA', serialNumber: 'SN1', disposition: 'vendor_return' }],
    });
    const data = await repo.getData();
    expect(data.units.find((u) => u.serialNumber === 'SN1')!.status).toBe('returned');
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'ring')).toBe(0);
  });

  it('records the disposition in the movement reason', async () => {
    await repo.recordReturn({
      source: 'customer',
      actor: 'ops@mwell',
      lines: [{ productId: 'shirt', quantity: 2, reason: 'wrong size', disposition: 'lost' }],
    });
    const data = await repo.getData();
    const mv = data.movements.find((m) => m.type === 'return')!;
    expect(mv.reason).toBe('wrong size (lost)');
  });

  it('adds non-serialized quantity back to stock when restocking', async () => {
    await repo.recordReturn({
      source: 'customer',
      actor: 'ops@mwell',
      lines: [{ productId: 'shirt', quantity: 4, reason: 'wrong size' }],
    });
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'shirt')).toBe(24);
  });

  it('restocks into the specified location', async () => {
    await repo.recordReturn({
      source: 'customer',
      actor: 'ops@mwell',
      lines: [
        { productId: 'shirt', quantity: 6, reason: 'wrong size', locationId: 'loc-cebu' },
      ],
    });
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'shirt', 'loc-cebu')).toBe(6);
    expect(availableForProduct(state, 'shirt', 'loc-wh')).toBe(20);
  });

  it('does not restock non-serialized quantity when lost or vendor_return', async () => {
    await repo.recordReturn({
      source: 'customer',
      actor: 'ops@mwell',
      lines: [
        { productId: 'shirt', quantity: 4, reason: 'damaged', disposition: 'lost' },
        { productId: 'shirt', quantity: 3, reason: 'recall', disposition: 'vendor_return' },
      ],
    });
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'shirt')).toBe(20);
  });
});

describe('createEvent', () => {
  it('creates an event and appends it', async () => {
    const event = await repo.createEvent({
      name: 'New Activation',
      type: 'corporate',
      siteLocationId: 'loc-wh',
      startDate: '2026-07-01',
    });
    expect(event.id).toMatch(/^evt-/);
    expect(event.name).toBe('New Activation');
    const data = await repo.getData();
    expect(data.events.some((e) => e.id === event.id)).toBe(true);
  });
});

describe('cancelAllocation', () => {
  it('cancels a reserved allocation without changing stock', async () => {
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'shirt', quantity: 5, actor: 'ops@mwell' });
    const before = availableForProduct(await repo.getStockState(), 'shirt');
    const cancelled = await repo.cancelAllocation({ allocationId: alloc.id, actor: 'ops@mwell' });
    expect(cancelled.status).toBe('cancelled');
    const after = availableForProduct(await repo.getStockState(), 'shirt');
    expect(after).toBe(before);
  });

  it('throws when the allocation is missing', async () => {
    await expect(
      repo.cancelAllocation({ allocationId: 'nope', actor: 'ops@mwell' }),
    ).rejects.toThrow(/not found/i);
  });

  it('throws when the allocation is already issued', async () => {
    const alloc = await repo.reserve({ eventId: 'e1', productId: 'ring', quantity: 1, actor: 'ops@mwell' });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell' });
    await expect(
      repo.cancelAllocation({ allocationId: alloc.id, actor: 'ops@mwell' }),
    ).rejects.toThrow(/issued/i);
  });
});

describe('setProductPrice', () => {
  it('updates the sell price', async () => {
    const updated = await repo.setProductPrice({
      productId: 'shirt',
      price: 499,
      actor: 'pricing@mwell',
    });
    expect(updated.price).toBe(499);
    const data = await repo.getData();
    expect(data.products.find((p) => p.id === 'shirt')!.price).toBe(499);
  });

  it('rejects a negative price', async () => {
    await expect(
      repo.setProductPrice({ productId: 'shirt', price: -5, actor: 'x' }),
    ).rejects.toThrow(/zero or more/i);
  });
});

describe('createProduct', () => {
  it('creates a new SKU and makes it queryable', async () => {
    const product = await repo.createProduct({
      sku: 'NEW-SKU',
      name: 'New Widget',
      category: 'merchandise',
      serialized: false,
      unitCost: 120,
      reorderPoint: 5,
      actor: 'logi@mwell',
    });
    expect(product.id).toMatch(/^prod-/);
    const data = await repo.getData();
    expect(data.products.some((p) => p.id === product.id)).toBe(true);
    expect(data.products.find((p) => p.id === product.id)!.reorderPoint).toBe(5);
  });

  it('rejects a duplicate SKU (case-insensitive)', async () => {
    await expect(
      repo.createProduct({
        sku: 'shirt',
        name: 'Dup',
        category: 'merchandise',
        serialized: false,
        unitCost: 1,
        reorderPoint: 1,
        actor: 'x',
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('rejects a blank name', async () => {
    await expect(
      repo.createProduct({
        sku: 'OK-SKU',
        name: '   ',
        category: 'merchandise',
        serialized: false,
        unitCost: 1,
        reorderPoint: 1,
        actor: 'x',
      }),
    ).rejects.toThrow(/name is required/i);
  });
});

describe('updateProduct', () => {
  it('updates editable fields including the reorder point', async () => {
    const updated = await repo.updateProduct({
      productId: 'shirt',
      patch: { name: 'Renamed Shirt', unitCost: 275, reorderPoint: 25, promotional: true },
      actor: 'logi@mwell',
    });
    expect(updated.name).toBe('Renamed Shirt');
    expect(updated.unitCost).toBe(275);
    expect(updated.reorderPoint).toBe(25);
    expect(updated.promotional).toBe(true);
    const data = await repo.getData();
    const persisted = data.products.find((p) => p.id === 'shirt')!;
    expect(persisted.reorderPoint).toBe(25);
  });

  it('rejects a negative reorder point', async () => {
    await expect(
      repo.updateProduct({ productId: 'shirt', patch: { reorderPoint: -1 }, actor: 'x' }),
    ).rejects.toThrow(/reorder point must be zero or more/i);
  });

  it('throws when the product is missing', async () => {
    await expect(
      repo.updateProduct({ productId: 'nope', patch: { name: 'X' }, actor: 'x' }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('createSupplier', () => {
  it('creates a supplier and appends it', async () => {
    const supplier = await repo.createSupplier({ name: 'New Vendor', leadTimeDays: 21 });
    expect(supplier.id).toMatch(/^sup-/);
    expect(supplier.leadTimeDays).toBe(21);
    const data = await repo.getData();
    expect(data.suppliers.some((s) => s.id === supplier.id)).toBe(true);
  });
});

describe('updateSupplier', () => {
  it('updates name and lead time', async () => {
    const updated = await repo.updateSupplier({
      supplierId: 'sup-1',
      name: 'Supplier One Renamed',
      leadTimeDays: 21,
    });
    expect(updated.name).toBe('Supplier One Renamed');
    expect(updated.leadTimeDays).toBe(21);
    const data = await repo.getData();
    expect(data.suppliers.find((s) => s.id === 'sup-1')!.leadTimeDays).toBe(21);
  });

  it('throws when the supplier is missing', async () => {
    await expect(
      repo.updateSupplier({ supplierId: 'nope', name: 'X', leadTimeDays: 1 }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('cancelPurchaseOrder', () => {
  it('cancels an open purchase order', async () => {
    const po = await repo.createPurchaseOrder({
      supplierId: 'sup-1',
      actor: 'proc@mwell',
      lines: [{ productId: 'shirt', quantityOrdered: 10 }],
    });
    const cancelled = await repo.cancelPurchaseOrder({ poId: po.id, actor: 'proc@mwell' });
    expect(cancelled.status).toBe('cancelled');
    const data = await repo.getData();
    expect(data.purchaseOrders.find((p) => p.id === po.id)!.status).toBe('cancelled');
  });

  it('refuses to cancel a fully received PO', async () => {
    const po = await repo.createPurchaseOrder({
      supplierId: 'sup-1',
      actor: 'proc@mwell',
      lines: [{ productId: 'ring', quantityOrdered: 2 }],
    });
    await repo.receiveAgainstPO({
      poId: po.id,
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'ring', quantityReceived: 2 }],
    });
    await expect(
      repo.cancelPurchaseOrder({ poId: po.id, actor: 'proc@mwell' }),
    ).rejects.toThrow(/received/i);
  });
});

describe('recordCycleCount', () => {
  it('creates a draft without changing stock or logging a movement', async () => {
    const count = await repo.recordCycleCount({
      locationId: 'loc-wh',
      category: 'merchandise',
      actor: 'finance@mwell',
      lines: [{ productId: 'shirt', expected: 20, counted: 17 }],
    });
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'shirt')).toBe(20);
    const data = await repo.getData();
    expect(data.movements.find((m) => m.type === 'cycle_count')).toBeUndefined();
    expect(count).toMatchObject({ status: 'draft', requestedBy: 'finance@mwell' });
  });
});

describe('transfer', () => {
  it('moves non-serialized availability between locations', async () => {
    const movements = await repo.transfer({
      productId: 'shirt',
      fromLocationId: 'loc-wh',
      toLocationId: 'loc-cebu',
      quantity: 5,
      actor: 'logi@mwell',
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe('transfer');

    const state = await repo.getStockState();
    const byLoc = stockByLocation(state, 'shirt');
    expect(byLoc).toEqual(
      expect.arrayContaining([
        { locationId: 'loc-wh', quantity: 15 },
        { locationId: 'loc-cebu', quantity: 5 },
      ]),
    );
    expect(availableForProduct(state, 'shirt')).toBe(20);
  });

  it('moves a serialized unit to the destination location', async () => {
    await repo.transfer({
      productId: 'ring',
      fromLocationId: 'loc-wh',
      toLocationId: 'loc-cebu',
      quantity: 1,
      actor: 'logi@mwell',
    });
    const state = await repo.getStockState();
    expect(availableForProduct(state, 'ring', 'loc-cebu')).toBe(1);
    expect(availableForProduct(state, 'ring', 'loc-wh')).toBe(0);
  });

  it('rejects transfers exceeding source availability', async () => {
    await expect(
      repo.transfer({
        productId: 'shirt',
        fromLocationId: 'loc-wh',
        toLocationId: 'loc-cebu',
        quantity: 999,
        actor: 'logi@mwell',
      }),
    ).rejects.toThrow(/only 20 available/i);
  });
});

describe('createPurchaseOrder', () => {
  it('creates an ordered PO with zeroed received quantities', async () => {
    const po = await repo.createPurchaseOrder({
      supplierId: 'sup-1',
      actor: 'proc@mwell',
      lines: [{ productId: 'shirt', quantityOrdered: 40 }],
    });
    expect(po.status).toBe('ordered');
    expect(po.lines[0]!.quantityReceived).toBe(0);

    const data = await repo.getData();
    expect(data.purchaseOrders).toHaveLength(1);
  });
});

describe('receiveAgainstPO', () => {
  it('increases inventory and partially receives the PO', async () => {
    const po = await repo.createPurchaseOrder({
      supplierId: 'sup-1',
      actor: 'proc@mwell',
      lines: [{ productId: 'shirt', quantityOrdered: 40 }],
    });
    const updated = await repo.receiveAgainstPO({
      poId: po.id,
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'shirt', quantityReceived: 10 }],
    });
    expect(updated.status).toBe('partially_received');
    expect(poTotalReceived(updated)).toBe(10);

    const data = await repo.getData();
    const state = toStockState(data);
    expect(availableForProduct(state, 'shirt')).toBe(30);
    expect(data.movements.some((m) => m.type === 'receipt' && m.reference === po.id)).toBe(true);
  });

  it('marks the PO received when fully received', async () => {
    const po = await repo.createPurchaseOrder({
      supplierId: 'sup-1',
      actor: 'proc@mwell',
      lines: [{ productId: 'ring', quantityOrdered: 2 }],
    });
    const updated = await repo.receiveAgainstPO({
      poId: po.id,
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'ring', quantityReceived: 2 }],
    });
    expect(updated.status).toBe('received');

    const state = await repo.getStockState();
    expect(availableForProduct(state, 'ring')).toBe(3); // 1 seed + 2 received
  });

  it('caps received quantity at the ordered amount', async () => {
    const po = await repo.createPurchaseOrder({
      supplierId: 'sup-1',
      actor: 'proc@mwell',
      lines: [{ productId: 'shirt', quantityOrdered: 5 }],
    });
    const updated = await repo.receiveAgainstPO({
      poId: po.id,
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'shirt', quantityReceived: 12 }],
    });
    expect(updated.lines[0]!.quantityReceived).toBe(5);
    expect(updated.status).toBe('received');
  });

  it('rejects receiving a product that is not on the PO', async () => {
    const po = await repo.createPurchaseOrder({
      supplierId: 'sup-1',
      actor: 'proc@mwell',
      lines: [{ productId: 'shirt', quantityOrdered: 5 }],
    });
    await expect(
      repo.receiveAgainstPO({
        poId: po.id,
        locationId: 'loc-wh',
        actor: 'logi@mwell',
        lines: [{ productId: 'ring', quantityReceived: 1 }],
      }),
    ).rejects.toThrow(/not on this PO/i);
  });

  it('refuses to receive against a cancelled PO', async () => {
    const po = await repo.createPurchaseOrder({
      supplierId: 'sup-1',
      actor: 'proc@mwell',
      lines: [{ productId: 'shirt', quantityOrdered: 5 }],
    });
    await repo.cancelPurchaseOrder({ poId: po.id, actor: 'proc@mwell' });
    await expect(
      repo.receiveAgainstPO({
        poId: po.id,
        locationId: 'loc-wh',
        actor: 'logi@mwell',
        lines: [{ productId: 'shirt', quantityReceived: 1 }],
      }),
    ).rejects.toThrow(/cancelled/i);
  });
});

describe('deleteLocation', () => {
  it('blocks deleting a location that still holds stock', async () => {
    // loc-wh holds seeded shirt stock and a ring unit.
    await expect(
      repo.deleteLocation({ locationId: 'loc-wh' }),
    ).rejects.toThrow(/still holds stock/i);
    const data = await repo.getData();
    expect(data.locations.some((l) => l.id === 'loc-wh')).toBe(true);
  });

  it('allows deleting an empty location', async () => {
    await repo.deleteLocation({ locationId: 'loc-cebu' });
    const data = await repo.getData();
    expect(data.locations.some((l) => l.id === 'loc-cebu')).toBe(false);
  });
});

describe('storage areas & bins', () => {
  it('puts received stock away into a bin', async () => {
    await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'shirt', quantity: 6, binId: 'bin-a' }],
    });
    const { stockByBin } = await import('./domain/storage');
    const state = await repo.getStockState();
    const rows = stockByBin(state, 'shirt', 'loc-wh');
    expect(rows).toContainEqual({ binId: 'bin-a', quantity: 6 });
    expect(rows).toContainEqual({ binId: undefined, quantity: 20 }); // seed general
    // location total unchanged in aggregate
    expect(availableForProduct(state, 'shirt', 'loc-wh')).toBe(26);
  });

  it('relocates non-serialized stock between bins', async () => {
    await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'a',
      lines: [{ productId: 'shirt', quantity: 10, binId: 'bin-a' }],
    });
    await repo.relocate({
      productId: 'shirt',
      locationId: 'loc-wh',
      fromBinId: 'bin-a',
      toBinId: 'bin-b',
      quantity: 4,
      actor: 'a',
    });
    const { stockByBin } = await import('./domain/storage');
    const state = await repo.getStockState();
    const rows = stockByBin(state, 'shirt', 'loc-wh');
    expect(rows).toContainEqual({ binId: 'bin-a', quantity: 6 });
    expect(rows).toContainEqual({ binId: 'bin-b', quantity: 4 });
    expect(availableForProduct(state, 'shirt', 'loc-wh')).toBe(30); // total preserved
  });

  it('rejects relocating more than the source bin holds', async () => {
    await expect(
      repo.relocate({
        productId: 'shirt',
        locationId: 'loc-wh',
        fromBinId: 'bin-a',
        toBinId: 'bin-b',
        quantity: 5,
        actor: 'a',
      }),
    ).rejects.toThrow(/only 0/i);
  });

  it('relocates a serialized unit into a bin', async () => {
    await repo.relocate({
      productId: 'ring',
      locationId: 'loc-wh',
      toBinId: 'bin-a',
      quantity: 1,
      actor: 'a',
    });
    const data = await repo.getData();
    expect(data.units.find((u) => u.serialNumber === 'SN1')?.binId).toBe('bin-a');
  });

  it('creates, updates and deletes storage areas', async () => {
    const created = await repo.createStorageArea({
      locationId: 'loc-wh',
      code: 'WH-C-01',
      label: 'Aisle C',
    });
    expect(created.code).toBe('WH-C-01');
    const updated = await repo.updateStorageArea({
      storageAreaId: created.id,
      code: 'WH-C-02',
    });
    expect(updated.code).toBe('WH-C-02');
    // put stock in, then delete — stock falls back to the general area
    await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'a',
      lines: [{ productId: 'shirt', quantity: 3, binId: created.id }],
    });
    await repo.deleteStorageArea({ storageAreaId: created.id });
    const data = await repo.getData();
    expect(data.storageAreas.some((b) => b.id === created.id)).toBe(false);
    expect(data.stockLevels.some((s) => s.binId === created.id)).toBe(false);
  });

  it('rejects duplicate bin codes in the same warehouse', async () => {
    await expect(
      repo.createStorageArea({ locationId: 'loc-wh', code: 'WH-A-01' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('puts PO-received stock away into a bin', async () => {
    const po = await repo.createPurchaseOrder({
      supplierId: 'sup-1',
      actor: 'proc@mwell',
      lines: [{ productId: 'shirt', quantityOrdered: 8 }],
    });
    await repo.receiveAgainstPO({
      poId: po.id,
      locationId: 'loc-wh',
      binId: 'bin-b',
      actor: 'logi@mwell',
      lines: [{ productId: 'shirt', quantityReceived: 8 }],
    });
    const { stockByBin } = await import('./domain/storage');
    const state = await repo.getStockState();
    expect(stockByBin(state, 'shirt', 'loc-wh')).toContainEqual({
      binId: 'bin-b',
      quantity: 8,
    });
  });

  it('restocks a returned item into a specific bin', async () => {
    await repo.recordReturn({
      source: 'customer',
      actor: 'ops@mwell',
      lines: [
        {
          productId: 'shirt',
          quantity: 2,
          reason: 'wrong size',
          disposition: 'restock',
          locationId: 'loc-wh',
          binId: 'bin-a',
        },
      ],
    });
    const { stockByBin } = await import('./domain/storage');
    const state = await repo.getStockState();
    expect(stockByBin(state, 'shirt', 'loc-wh')).toContainEqual({
      binId: 'bin-a',
      quantity: 2,
    });
  });
});

describe('integrity guards (v7)', () => {
  it('does not duplicate stock when transferring from an empty source bin', async () => {
    // All shirt stock lives in the general area (no bin). Moving "from bin-a"
    // (empty) must throw instead of crediting the destination.
    await expect(
      repo.transfer({
        productId: 'shirt',
        fromLocationId: 'loc-wh',
        toLocationId: 'loc-cebu',
        fromBinId: 'bin-a',
        quantity: 5,
        actor: 'logi@mwell',
      }),
    ).rejects.toThrow(/insufficient/i);
    const state = await repo.getStockState();
    // Nothing moved: WH still 20, Cebu still 0.
    expect(availableForProduct(state, 'shirt', 'loc-wh')).toBe(20);
    expect(availableForProduct(state, 'shirt', 'loc-cebu')).toBe(0);
  });

  it('rejects a return referencing an unknown serial', async () => {
    await expect(
      repo.recordReturn({
        source: 'customer',
        actor: 'ops@mwell',
        lines: [
          {
            productId: 'ring',
            quantity: 1,
            reason: 'typo serial',
            disposition: 'restock',
            serialNumber: 'DOES-NOT-EXIST',
          },
        ],
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('issues non-serialized stock across multiple bins without going negative', async () => {
    // Split shirt stock across two bins, then issue more than any single bin.
    await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'shirt', quantity: 3, binId: 'bin-a' }],
    });
    await repo.receiveStock({
      locationId: 'loc-wh',
      actor: 'logi@mwell',
      lines: [{ productId: 'shirt', quantity: 3, binId: 'bin-b' }],
    });
    const alloc = await repo.reserve({
      productId: 'shirt',
      quantity: 5,
      eventId: 'e1',
      actor: 'ops@mwell',
    });
    await repo.issue({ allocationId: alloc.id, actor: 'ops@mwell' });
    const state = await repo.getStockState();
    // 20 general + 3 + 3 = 26 on hand, minus 5 issued = 21.
    expect(availableForProduct(state, 'shirt', 'loc-wh')).toBe(21);
    expect(availableForProduct(state, 'shirt', 'loc-wh')).toBeGreaterThanOrEqual(0);
  });
});

describe('persistence', () => {
  it('reloads persisted data from storage', async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const r1 = new InMemoryRepository(miniData(), { storage });
    await r1.receiveStock({ locationId: 'loc-wh', actor: 'a', lines: [{ productId: 'shirt', quantity: 10 }] });

    const r2 = new InMemoryRepository(miniData(), { storage });
    const state = await r2.getStockState();
    expect(availableForProduct(state, 'shirt')).toBe(30);
  });
});

describe('W1 control parity', () => {
  it('keeps held stock on hand but removes it from available inventory', async () => {
    const controlled = new InMemoryRepository({
      ...miniData(),
      receipts: [{
        id: 'rcpt-1', locationId: 'loc-wh',
        lines: [{ productId: 'shirt', quantity: 5 }],
        actor: 'receiver@mwell', createdAt: '2026-07-10T00:00:00Z',
      }],
    }, {
      now: () => '2026-07-10T01:00:00Z',
      id: (prefix) => `${prefix}-fixed`,
    });
    await controlled.inspectQuality({
      idempotencyKey: 'quality-memory-01', sourceType: 'receipt', sourceId: 'rcpt-1',
      productId: 'shirt', quantity: 5, disposition: 'hold', reason: 'Damaged cartons',
    });
    const position = (await controlled.listInventoryPositions({})).rows.find(
      (row) => row.productId === 'shirt' && row.locationId === 'loc-wh' && !row.binId,
    )!;
    expect(position).toMatchObject({ onHand: 20, held: 5, available: 15 });

    const hold = (await controlled.listHolds({ status: 'active' })).rows[0]!;
    await controlled.releaseHold({
      idempotencyKey: 'release-memory-01', holdId: hold.id,
      targetDisposition: 'accepted', reason: 'QC retest passed',
      evidenceUrls: ['memory/retest.jpg'],
    });
    const released = (await controlled.listInventoryPositions({})).rows.find(
      (row) => row.productId === 'shirt' && row.locationId === 'loc-wh' && !row.binId,
    )!;
    expect(released).toMatchObject({ onHand: 20, held: 0, available: 20 });
  });

  it('denies reservations against quantity protected by an active hold', async () => {
    const controlled = new InMemoryRepository({
      ...miniData(),
      receipts: [{
        id: 'rcpt-reserved-hold', locationId: 'loc-wh',
        lines: [{ productId: 'shirt', quantity: 20 }],
        actor: 'receiver@mwell', createdAt: '2026-07-10T00:00:00Z',
      }],
    }, {
      now: () => '2026-07-10T01:00:00Z',
      id: (prefix) => `${prefix}-reserved-hold`,
    });
    await controlled.inspectQuality({
      idempotencyKey: 'quality-reserved-hold', sourceType: 'receipt',
      sourceId: 'rcpt-reserved-hold', productId: 'shirt', quantity: 20,
      disposition: 'hold', reason: 'Awaiting governed release',
    });

    await expect(controlled.reserve({
      eventId: 'e1', productId: 'shirt', quantity: 1, actor: 'operator@mwell',
    })).rejects.toThrow(/available|hold|insufficient/i);
    expect((await controlled.getData()).allocations).toHaveLength(0);
  });

  it('does not mutate stock until final count approval and posts only once', async () => {
    const controlled = new InMemoryRepository({
      ...miniData(),
      cycleCounts: [{
        id: 'cc-1', locationId: 'loc-wh',
        lines: [{ productId: 'shirt', expected: 0, counted: 18 }],
        status: 'draft', actor: 'counter@mwell', createdAt: '2026-07-10T00:00:00Z',
      }],
    }, {
      now: () => '2026-07-10T01:00:00Z',
      id: (prefix) => `${prefix}-fixed`,
    });
    const requests = await controlled.submitCycleCount({
      idempotencyKey: 'count-memory-001', cycleCountId: 'cc-1', reason: 'Scheduled count',
    });
    expect((await controlled.getData()).stockLevels[0]!.quantity).toBe(20);
    expect(requests).toHaveLength(1);

    const decision = {
      idempotencyKey: 'decision-memory1', requestId: requests[0]!.id,
      decision: 'approved' as const,
    };
    const supervisor = {
      actor: 'supervisor@mwell', capabilities: ['approve_stock_adjustment'] as const,
      approvalGroups: ['warehouse_supervisor'] as const,
    };
    await controlled.decideStockChange(decision, supervisor);
    await controlled.decideStockChange(decision, supervisor);
    const data = await controlled.getData();
    expect(data.stockLevels[0]!.quantity).toBe(18);
    expect(data.movements.filter((movement) => movement.reference === requests[0]!.id)).toHaveLength(1);
  });

  it('rejects unexpected or duplicate serialized scans', async () => {
    const controlled = new InMemoryRepository(miniData(), {
      now: () => '2026-07-10T01:00:00Z',
      id: (prefix) => `${prefix}-serialized-invalid`,
    });
    const unexpected = await controlled.recordCycleCount({
      locationId: 'loc-wh', actor: 'counter@mwell',
      lines: [{ productId: 'ring', expected: 1, counted: 1, serialNumbers: ['UNKNOWN'] }],
    });
    await expect(controlled.submitCycleCount({
      idempotencyKey: 'serialized-unexpected-001', cycleCountId: unexpected.id, reason: 'Device count',
    })).rejects.toThrow(/unknown serial/i);

    const duplicate = await controlled.recordCycleCount({
      locationId: 'loc-wh', actor: 'counter@mwell',
      lines: [{ productId: 'ring', expected: 1, counted: 2, serialNumbers: ['SN1', 'SN1'] }],
    });
    await expect(controlled.submitCycleCount({
      idempotencyKey: 'serialized-duplicate-001', cycleCountId: duplicate.id, reason: 'Device count',
    })).rejects.toThrow(/duplicate serial/i);
  });

  it('marks a missing serialized unit lost only after final approval', async () => {
    const data = miniData();
    data.units.push({ id: 'u2', productId: 'ring', serialNumber: 'SN2', locationId: 'loc-wh', status: 'in_stock' });
    const controlled = new InMemoryRepository(data, {
      now: () => '2026-07-10T01:00:00Z',
      id: (prefix) => `${prefix}-serialized-missing`,
    });
    const count = await controlled.recordCycleCount({
      locationId: 'loc-wh', actor: 'counter@mwell',
      lines: [{ productId: 'ring', expected: 2, counted: 1, serialNumbers: ['SN1'] }],
    });
    const [request] = await controlled.submitCycleCount({
      idempotencyKey: 'serialized-missing-submit', cycleCountId: count.id, reason: 'Device count',
    });
    expect((await controlled.getData()).units.find((unit) => unit.serialNumber === 'SN2')?.status).toBe('in_stock');
    await controlled.decideStockChange({
      idempotencyKey: 'serialized-missing-approve', requestId: request!.id, decision: 'approved',
    }, { actor: 'supervisor@mwell', capabilities: ['approve_stock_adjustment'], approvalGroups: ['warehouse_supervisor'] });
    expect((await controlled.getData()).units.find((unit) => unit.serialNumber === 'SN2')?.status).toBe('lost');
  });

  it('keeps Supervisor, Finance, and requester decisions in their exact memory tiers', async () => {
    const data = miniData();
    data.products.find((product) => product.id === 'shirt')!.unitCost = 6_000;
    data.cycleCounts = [{
      id: 'cc-tiered', locationId: 'loc-wh',
      lines: [{ productId: 'shirt', expected: 20, counted: 18 }],
      status: 'draft', actor: 'counter@mwell', requestedBy: 'counter@mwell',
      createdAt: '2026-07-10T00:00:00Z',
    }];
    const controlled = new InMemoryRepository(data, {
      now: () => '2026-07-10T01:00:00Z', id: (prefix) => `${prefix}-tiered`,
    });
    const [request] = await controlled.submitCycleCount({
      idempotencyKey: 'tiered-submit-01', cycleCountId: 'cc-tiered', reason: 'Material variance',
    });

    await expect(controlled.decideStockChange({
      idempotencyKey: 'tiered-finance-early', requestId: request!.id, decision: 'approved',
    }, { actor: 'finance@mwell', capabilities: ['approve_stock_adjustment_finance'], approvalGroups: ['finance'] }))
      .rejects.toThrow(/approval group/i);
    await expect(controlled.decideStockChange({
      idempotencyKey: 'tiered-requester', requestId: request!.id, decision: 'approved',
    }, { actor: 'counter@mwell', capabilities: ['approve_stock_adjustment'], approvalGroups: ['warehouse_supervisor'] }))
      .rejects.toThrow(/requester/i);
    const afterSupervisor = await controlled.decideStockChange({
      idempotencyKey: 'tiered-supervisor', requestId: request!.id, decision: 'approved',
    }, { actor: 'supervisor@mwell', capabilities: ['approve_stock_adjustment'], approvalGroups: ['warehouse_supervisor'] });
    expect(afterSupervisor.status).toBe('pending_finance');
    await expect(controlled.decideStockChange({
      idempotencyKey: 'tiered-supervisor-late', requestId: request!.id, decision: 'approved',
    }, { actor: 'supervisor@mwell', capabilities: ['approve_stock_adjustment'], approvalGroups: ['warehouse_supervisor'] }))
      .rejects.toThrow(/approval group/i);
    await controlled.decideStockChange({
      idempotencyKey: 'tiered-finance', requestId: request!.id, decision: 'approved',
    }, { actor: 'finance@mwell', capabilities: ['approve_stock_adjustment_finance'], approvalGroups: ['finance'] });
    expect((await controlled.getData()).stockLevels[0]!.quantity).toBe(18);
  });

  it('queues a manual stock change and mutates only after a different authorized approval', async () => {
    const controlled = new InMemoryRepository(miniData(), {
      now: () => '2026-07-10T01:00:00Z', id: (prefix) => `${prefix}-manual`,
    });
    const request = await controlled.requestStockChange({
      idempotencyKey: 'manual-request-001', sourceType: 'write_off',
      productId: 'shirt', locationId: 'loc-wh', quantityDelta: -2,
      reason: 'Damaged during storage', evidenceUrls: ['evidence/damage.jpg'],
    }, { actor: 'operator@mwell', capabilities: ['manage_inventory'], approvalGroups: ['warehouse_operator'] });
    expect(request.status).toBe('pending_supervisor');
    expect((await controlled.getData()).stockLevels[0]!.quantity).toBe(20);

    await expect(controlled.decideStockChange({
      idempotencyKey: 'manual-self-approval', requestId: request.id, decision: 'approved',
    }, { actor: 'operator@mwell', capabilities: ['approve_stock_adjustment'], approvalGroups: ['warehouse_supervisor'] }))
      .rejects.toThrow(/requester/i);
    await controlled.decideStockChange({
      idempotencyKey: 'manual-supervisor-approval', requestId: request.id, decision: 'approved',
    }, { actor: 'supervisor@mwell', capabilities: ['approve_stock_adjustment'], approvalGroups: ['warehouse_supervisor'] });
    expect((await controlled.getData()).stockLevels[0]!.quantity).toBe(18);
  });

  it('rejects every serialized manual stock change at submission', async () => {
    const controlled = new InMemoryRepository(miniData(), {
      now: () => '2026-07-10T01:00:00Z', id: (prefix) => `${prefix}-serialized-manual`,
    });
    for (const [sourceType, quantityDelta] of [
      ['adjustment', 1],
      ['write_off', -1],
    ] as const) {
      await expect(controlled.requestStockChange({
        idempotencyKey: `serialized-${sourceType}`, sourceType,
        productId: 'ring', locationId: 'loc-wh', quantityDelta,
        reason: 'Manual serialized correction', evidenceUrls: [],
      }, { actor: 'operator-profile-id', capabilities: ['manage_inventory'], approvalGroups: ['warehouse_operator'] }))
        .rejects.toThrow(/identified cycle count/i);
    }
    expect((await controlled.listStockChangeRequests({})).rows).toHaveLength(0);
  });

  it('rejects an approved signed delta when locked stock is insufficient', async () => {
    const controlled = new InMemoryRepository(miniData(), {
      now: () => '2026-07-10T01:00:00Z', id: (prefix) => `${prefix}-insufficient`,
    });
    const request = await controlled.requestStockChange({
      idempotencyKey: 'insufficient-request', sourceType: 'adjustment',
      productId: 'shirt', locationId: 'loc-wh', quantityDelta: -21,
      reason: 'Reconciliation correction', evidenceUrls: [],
    }, { actor: 'operator@mwell', capabilities: ['manage_inventory'], approvalGroups: ['warehouse_operator'] });
    await expect(controlled.decideStockChange({
      idempotencyKey: 'insufficient-approve', requestId: request.id, decision: 'approved',
    }, { actor: 'supervisor@mwell', capabilities: ['approve_stock_adjustment'], approvalGroups: ['warehouse_supervisor'] }))
      .rejects.toThrow(/negative|insufficient/i);
    const data = await controlled.getData();
    expect(data.stockLevels[0]!.quantity).toBe(20);
    expect((await controlled.listStockChangeRequests({})).rows[0]?.status).toBe('pending_supervisor');
    expect(data.movements.filter((movement) => movement.reference === request.id)).toHaveLength(0);
    expect((await controlled.listExceptions({})).rows.find((row) => row.sourceId === request.id)?.status)
      .toBe('open');
  });

  it('requires configured groups and distinct requester Supervisor and Finance actors', async () => {
    const data = miniData();
    data.products.find((product) => product.id === 'shirt')!.unitCost = 6_000;
    const controlled = new InMemoryRepository(data, {
      now: () => '2026-07-10T01:00:00Z', id: (prefix) => `${prefix}-distinct-tier`,
    });
    const request = await controlled.requestStockChange({
      idempotencyKey: 'distinct-tier-request', sourceType: 'adjustment',
      productId: 'shirt', locationId: 'loc-wh', quantityDelta: -2,
      reason: 'Material reconciliation', evidenceUrls: [],
    }, { actor: 'requester-profile-id', capabilities: ['manage_inventory'], approvalGroups: ['warehouse_operator'] });

    await expect(controlled.decideStockChange({
      idempotencyKey: 'all-cap-admin-wrong-group', requestId: request.id, decision: 'approved',
    }, {
      actor: 'admin-profile-id',
      capabilities: ['approve_stock_adjustment', 'approve_stock_adjustment_finance'],
      approvalGroups: ['warehouse_admin'],
    })).rejects.toThrow(/approval group/i);

    const supervisor = await controlled.decideStockChange({
      idempotencyKey: 'distinct-tier-supervisor', requestId: request.id, decision: 'approved',
    }, {
      actor: 'supervisor-profile-id', capabilities: ['approve_stock_adjustment'],
      approvalGroups: ['warehouse_supervisor'],
    });
    expect(supervisor.status).toBe('pending_finance');

    await expect(controlled.decideStockChange({
      idempotencyKey: 'same-person-finance', requestId: request.id, decision: 'approved',
    }, {
      actor: 'supervisor-profile-id', capabilities: ['approve_stock_adjustment_finance'],
      approvalGroups: ['finance'],
    })).rejects.toThrow(/distinct|supervisor/i);

    await controlled.decideStockChange({
      idempotencyKey: 'distinct-tier-finance', requestId: request.id, decision: 'approved',
    }, {
      actor: 'finance-profile-id', capabilities: ['approve_stock_adjustment_finance'],
      approvalGroups: ['finance'],
    });
    expect((await controlled.getData()).stockLevels[0]!.quantity).toBe(18);
  });

  it('moves a vendor-return hold into supplier custody exactly once', async () => {
    const controlled = new InMemoryRepository({
      ...miniData(),
      receipts: [{
        id: 'rcpt-vendor', supplierId: 'sup-1', locationId: 'loc-wh',
        lines: [{ productId: 'shirt', quantity: 3 }],
        actor: 'receiver@mwell', createdAt: '2026-07-10T00:00:00Z',
      }],
    }, {
      now: () => '2026-07-10T01:00:00Z',
      id: (prefix) => `${prefix}-vendor`,
    });
    await controlled.inspectQuality({
      idempotencyKey: 'quality-vendor-001', sourceType: 'receipt', sourceId: 'rcpt-vendor',
      productId: 'shirt', quantity: 3, disposition: 'vendor_return',
      reason: 'Supplier packaging failure', evidenceUrls: ['memory/damage.jpg'],
    });
    const hold = (await controlled.listHolds({ status: 'active' })).rows[0]!;
    const input = {
      idempotencyKey: 'vendor-return-001', holdId: hold.id, supplierId: 'sup-1',
      reason: 'Rejected at incoming QC', reference: 'RMA-2026-001',
      evidenceUrls: ['memory/rma.jpg'],
    };
    const created = await controlled.createVendorReturn(input);
    const replayed = await controlled.createVendorReturn(input);

    expect(replayed.id).toBe(created.id);
    expect((await controlled.listHolds({})).rows[0]).toMatchObject({ status: 'vendor_return' });
    expect((await controlled.listVendorReturns({})).rows).toEqual([
      expect.objectContaining({ supplierId: 'sup-1', reference: 'RMA-2026-001', status: 'ready' }),
    ]);
    expect((await controlled.getData()).stockLevels[0]!.quantity).toBe(17);
  });

  it('prevents disabling the last active operation route', async () => {
    const controlled = new InMemoryRepository(miniData(), {
      now: () => '2026-07-10T01:00:00Z',
      id: (prefix) => `${prefix}-route-guard`,
    });
    const route = (await controlled.getData()).operationRoutes![0]!;
    await expect(controlled.updateOperationRoute({
      idempotencyKey: 'operation-route-disable-last',
      routeId: route.id,
      patch: {
        sourceLocationTypes: route.sourceLocationTypes,
        destinationLocationTypes: route.destinationLocationTypes,
        requiresEvidence: route.requiresEvidence,
        requiresApproval: route.requiresApproval,
        requiresOnline: route.requiresOnline,
        active: false,
      },
    })).rejects.toThrow(/last active route/i);
  });
});
