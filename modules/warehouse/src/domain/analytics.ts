import type { EventType, Movement, Product, WarehouseEvent } from './types';

/** Returned as a percentage of issued, rounded to one decimal. */
export function returnRate(issued: number, returned: number): number {
  if (issued <= 0) return 0;
  return Math.round((returned / issued) * 1000) / 10;
}

function sumQty(
  movements: Movement[],
  type: Movement['type'],
  productId: string,
): number {
  return movements
    .filter((m) => m.type === type && m.productId === productId)
    .reduce((sum, m) => sum + m.quantity, 0);
}

export interface DeviceUtilizationRow {
  productId: string;
  sku: string;
  name: string;
  issued: number;
  returned: number;
  outstanding: number;
  returnRate: number;
}

export function deviceUtilization(
  movements: Movement[],
  products: Product[],
): DeviceUtilizationRow[] {
  return products
    .filter((p) => p.category === 'device')
    .map((p) => {
      const issued = sumQty(movements, 'issue', p.id);
      const returned = sumQty(movements, 'return', p.id);
      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        issued,
        returned,
        outstanding: issued - returned,
        returnRate: returnRate(issued, returned),
      };
    })
    .filter((row) => row.issued > 0 || row.returned > 0);
}

export interface FastMovingRow {
  productId: string;
  sku: string;
  name: string;
  issued: number;
}

export function fastMovingSkus(
  movements: Movement[],
  products: Product[],
  limit = 5,
): FastMovingRow[] {
  return products
    .map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      issued: sumQty(movements, 'issue', p.id),
    }))
    .filter((r) => r.issued > 0)
    .sort((a, b) => b.issued - a.issued)
    .slice(0, limit);
}

export interface EventTypeConsumption {
  eventType: EventType;
  issued: number;
}

export function consumptionByEventType(
  movements: Movement[],
  events: WarehouseEvent[],
): EventTypeConsumption[] {
  const typeByEvent = new Map(events.map((e) => [e.id, e.type]));
  const totals = new Map<EventType, number>();
  for (const m of movements) {
    if (m.type !== 'issue' || !m.eventId) continue;
    const type = typeByEvent.get(m.eventId);
    if (!type) continue;
    totals.set(type, (totals.get(type) ?? 0) + m.quantity);
  }
  return [...totals.entries()].map(([eventType, issued]) => ({
    eventType,
    issued,
  }));
}
