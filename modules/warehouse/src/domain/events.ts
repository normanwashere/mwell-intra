import type { Allocation, Movement, Product } from './types';

export interface EventSummary {
  reserved: number;
  allocated: number;
  issued: number;
  returned: number;
  consumed: number;
}

function sumMovementQty(
  movements: Movement[],
  type: Movement['type'],
  eventId: string,
): number {
  return movements
    .filter((m) => m.type === type && m.eventId === eventId)
    .reduce((sum, m) => sum + m.quantity, 0);
}

function sumAllocationQty(
  allocations: Allocation[],
  status: Allocation['status'],
  eventId: string,
): number {
  return allocations
    .filter((a) => a.eventId === eventId && a.status === status)
    .reduce((sum, a) => sum + a.quantity, 0);
}

/**
 * Headline numbers for an event. Issued/returned come from the movement
 * ledger; reserved/allocated from open allocations. Consumed = issued -
 * returned (floored at zero).
 */
export function eventSummary(
  allocations: Allocation[],
  movements: Movement[],
  eventId: string,
): EventSummary {
  const issued = sumMovementQty(movements, 'issue', eventId);
  const returned = sumMovementQty(movements, 'return', eventId);
  return {
    reserved: sumAllocationQty(allocations, 'reserved', eventId),
    allocated: sumAllocationQty(allocations, 'allocated', eventId),
    issued,
    returned,
    consumed: Math.max(0, issued - returned),
  };
}

export interface EventCosting {
  issuedValue: number;
  returnedValue: number;
  consumedValue: number;
  promoValue: number;
  soldValue: number;
}

/**
 * Peso valuation of an event using each product's unit cost. Promotional
 * give-aways are split out from sold/used value via product.promotional.
 */
export function eventCosting(
  movements: Movement[],
  products: Product[],
  eventId: string,
): EventCosting {
  let issuedValue = 0;
  let returnedValue = 0;
  let consumedValue = 0;
  let promoValue = 0;

  for (const product of products) {
    const issued = sumMovementQty(
      movements.filter((m) => m.productId === product.id),
      'issue',
      eventId,
    );
    const returned = sumMovementQty(
      movements.filter((m) => m.productId === product.id),
      'return',
      eventId,
    );
    const consumed = Math.max(0, issued - returned);
    const consumedCost = consumed * product.unitCost;

    issuedValue += issued * product.unitCost;
    returnedValue += returned * product.unitCost;
    consumedValue += consumedCost;
    if (product.promotional === true) promoValue += consumedCost;
  }

  return {
    issuedValue,
    returnedValue,
    consumedValue,
    promoValue,
    soldValue: consumedValue - promoValue,
  };
}
