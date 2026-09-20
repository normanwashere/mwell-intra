import type { CustomerReturnCase, FulfillmentOrder, WarehouseData } from '@intra/data-kit';
import { resolveWarehouseScan } from '@/components/camera/WarehouseScanFlow';

// A navigation guard only: intake must still revalidate custody on submission.
export function hasReturnableOrderCustody(
  order: FulfillmentOrder | undefined,
  data: WarehouseData | null | undefined,
  returnCase?: CustomerReturnCase,
): boolean {
  if (!order || !data || !['released', 'completed'].includes(order.status)) return false;
  if (returnCase && (returnCase.sourceOrderId !== order.id || ['resolved', 'closed'].includes(returnCase.status))) return false;
  const returned = data.returns.filter(record => record.sourceOrderId === order.id).flatMap(record => record.lines);
  return order.lines.some(line => {
    if (!Number.isSafeInteger(line.pickedQuantity) || line.pickedQuantity <= 0) return false;
    if (returnCase && line.productId !== returnCase.productId) return false;
    const product = data.products.find(item => item.id === line.productId);
    if (!product) return false;
    if (product.serialized) return (line.pickedSerialNumbers ?? []).some(serial => {
      const identity = serial.trim().toUpperCase();
      if (returnCase?.serialNumber && returnCase.serialNumber.trim().toUpperCase() !== identity) return false;
      if (returned.some(item => item.productId === line.productId && item.serialNumber?.trim().toUpperCase() === identity)) return false;
      return resolveWarehouseScan({ data, context: 'return', code: serial, expectedProductId: line.productId, expectedEventId: order.eventId }).ok;
    });
    const picked = order.lines.filter(item => item.productId === line.productId).reduce((sum, item) => sum + item.pickedQuantity, 0);
    const received = returned.filter(item => item.productId === line.productId).reduce((sum, item) => sum + item.quantity, 0);
    return Number.isSafeInteger(picked) && Number.isSafeInteger(received) && received >= 0 && picked > received;
  });
}
