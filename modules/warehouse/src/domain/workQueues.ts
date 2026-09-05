import type { FulfillmentOrder, PurchaseOrder } from './types';
import type { BridgedPO } from '../data/procurementBridge';

export const FLOOR_WORK_PATH = '/fulfillment?filter=floor_work';
export function isFloorWork(order: Pick<FulfillmentOrder, 'status'>): boolean {
  return ['received', 'allocated', 'picking', 'packing', 'ready'].includes(order.status);
}
export function isReleasedFollowUp(order: Pick<FulfillmentOrder, 'status'>): boolean {
  return order.status === 'released';
}
export function isReceivableInbound(po: BridgedPO): boolean {
  return po.status === 'issued' && po.lines.some(line => line.quantity > line.receivedQuantity);
}
export function inboundQueue(bridged: BridgedPO[], legacy: PurchaseOrder[], source: string) {
  const unique = [...new Map(bridged.map(po => [po.id, po])).values()];
  const receivable = unique.filter(isReceivableInbound);
  const legacyOpen = source === 'memory' ? legacy.filter(po =>
    !unique.some(item => item.id === po.id) && ['ordered', 'partially_received'].includes(po.status)) : [];
  const outstandingUnits = receivable.reduce((sum, po) => sum + po.lines.reduce((n, line) => n + Math.max(0, line.quantity - line.receivedQuantity), 0), 0);
  const valueKnown = receivable.every(po => po.lines.every(line => Number.isFinite(line.unitPrice)));
  return { receivable, legacyOpen, count: receivable.length + legacyOpen.length, outstandingUnits,
    outstandingValue: valueKnown ? receivable.reduce((sum, po) => sum + po.lines.reduce((n, line) => n + Math.max(0, line.quantity - line.receivedQuantity) * line.unitPrice!, 0), 0) : null,
    awaitingIssue: unique.filter(po => po.status === 'approved') };
}
