import type { QualityInspectionSummary, StockChangeRequest, WarehouseData, WarehouseException } from '@intra/data-kit';
import type { WarehouseRouteId } from '@/app/modules';

export function productIdentity(data: WarehouseData | null, id: string) {
  const product = data?.products.find(p => p.id === id);
  return product ? `${product.name} / ${product.sku}` : 'Product details unavailable';
}

export function sourceIdentity(data: WarehouseData | null, type: string, id: string) {
  if (type === 'receipt') {
    const receipt = data?.receipts.find(r => r.id === id);
    const location = data?.locations.find(l => l.id === receipt?.locationId);
    return [receipt?.deliveryReference && `Delivery ${receipt.deliveryReference}`, `Receipt ${id}`, location?.name].filter(Boolean).join(' / ');
  }
  if (type === 'cycle_count') {
    const count = data?.cycleCounts.find(c => c.id === id);
    const location = data?.locations.find(l => l.id === count?.locationId);
    const bin = data?.storageAreas?.find(b => b.id === count?.binId);
    return ['Cycle count', location?.name, bin?.code, count?.createdAt.slice(0, 10)].filter(Boolean).join(' / ');
  }
  return `${type === 'return' ? 'Return' : 'Source'} ${id}`;
}

export function exceptionPresentation(
  data: WarehouseData | null,
  exception: WarehouseException,
  requests: readonly StockChangeRequest[],
  inspections: readonly QualityInspectionSummary[],
  canOpenRoute: (route: WarehouseRouteId) => boolean,
) {
  const id = encodeURIComponent(exception.sourceId);
  const request = requests.find(r => r.id === exception.sourceId);
  const inspection = inspections.find(i => i.id === exception.sourceId);
  let summary: string | undefined;
  let context: string | undefined;
  let source: { path: string; routeId: WarehouseRouteId } | undefined;
  if (exception.sourceType === 'stock_change_request') {
    if (request) {
      summary = productIdentity(data, request.productId);
      context = [sourceIdentity(data, request.sourceType, request.sourceId),
        data?.locations.find(l => l.id === request.locationId)?.name,
        data?.storageAreas?.find(b => b.id === request.binId)?.code,
        `Variance ${request.quantityDelta > 0 ? '+' : ''}${request.quantityDelta}`].filter(Boolean).join(' / ');
    }
    if (canOpenRoute('approvals')) source = { path: `/approvals?request=${id}`, routeId: 'approvals' };
    else if (request?.sourceType === 'cycle_count') source = { path: `/cycle-counts?count=${encodeURIComponent(request.sourceId)}`, routeId: 'cycle-counts' };
  } else if (exception.sourceType === 'quality_inspection') {
    if (inspection) {
      summary = productIdentity(data, inspection.productId);
      context = [sourceIdentity(data, inspection.sourceType, inspection.sourceId), inspection.serialNumber].filter(Boolean).join(' / ');
    }
    source = { path: `/quality?inspection=${id}`, routeId: 'quality' };
  } else if (exception.sourceType === 'cycle_count') {
    const count = data?.cycleCounts.find(c => c.id === exception.sourceId);
    summary = count?.lines.map(l => productIdentity(data, l.productId)).join('; ');
    context = sourceIdentity(data, 'cycle_count', exception.sourceId);
    source = { path: `/cycle-counts?count=${id}`, routeId: 'cycle-counts' };
  } else if (exception.sourceType === 'receipt') {
    context = sourceIdentity(data, 'receipt', exception.sourceId);
    summary = data?.receipts.find(r => r.id === exception.sourceId)?.lines.map(l => productIdentity(data, l.productId)).join('; ');
    source = exception.type === 'po_receipt'
      ? { path: `/purchase-orders?receipt=${id}`, routeId: 'purchase-orders' }
      : { path: `/receiving?receipt=${id}`, routeId: 'receiving' };
  } else if (exception.sourceType === 'import_job') {
    context = 'Warehouse import';
    source = { path: `/imports?job=${id}`, routeId: 'imports' };
  }
  return { summary, context, source: source && canOpenRoute(source.routeId) ? source : undefined };
}
