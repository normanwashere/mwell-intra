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
  valuationAvailable: boolean;
  outcomeValuationAvailable: boolean;
  lostValue: number;
  damagedValue: number;
  issuedValue: number;
  returnedValue: number;
  consumedValue: number;
  promoValue: number;
  soldValue: number;
}

/**
 * Custody is not a sale. Missing historical valuation is explicitly unavailable;
 * current catalogue cost and promotional flags cannot restate historical facts.
 */
export function eventCosting(
  movements: Movement[],
  _products: Product[],
  eventId: string,
  outcomes?: { status: string; sold: number; giveaway: number; lost: number; damaged: number },
): EventCosting {
  let issuedValue = 0;
  let returnedValue = 0;
  const relevant = movements.filter(m => m.eventId === eventId && ['issue', 'return'].includes(m.type));
  const valuationAvailable = relevant.every(m => Number.isFinite(m.unitCostAtMovement));
  for (const movement of relevant) {
    if (movement.type === 'issue') issuedValue += movement.quantity * (movement.unitCostAtMovement ?? 0);
    if (movement.type === 'return') returnedValue += movement.quantity * (movement.unitCostAtMovement ?? 0);
  }

  const issues = relevant.filter(m => m.type === 'issue');
  const costs = new Set(issues.map(m => m.unitCostAtMovement));
  const unitCost = issues.length > 0 && costs.size === 1 && Number.isFinite(issues[0]?.unitCostAtMovement) ? issues[0]!.unitCostAtMovement! : undefined;
  const outcomeValuationAvailable = outcomes?.status === 'approved' && unitCost !== undefined;

  return {
    valuationAvailable,
    outcomeValuationAvailable,
    issuedValue,
    returnedValue,
    consumedValue: Math.max(0, issuedValue - returnedValue),
    promoValue: outcomeValuationAvailable ? outcomes!.giveaway * unitCost! : 0,
    soldValue: outcomeValuationAvailable ? outcomes!.sold * unitCost! : 0,
    lostValue: outcomeValuationAvailable ? outcomes!.lost * unitCost! : 0,
    damagedValue: outcomeValuationAvailable ? outcomes!.damaged * unitCost! : 0,
  };
}
