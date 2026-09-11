import type { OutboxEntry, WarehouseData } from '@intra/data-kit';
import { userFacingError } from '@intra/ui';

const ACTIONS: Record<OutboxEntry['method'], string> = {
  receiveStock: 'Receive stock', recordCycleCount: 'Save stock count', recordReturn: 'Receive returned stock',
  issue: 'Release allocation', transfer: 'Transfer stock', relocate: 'Move stock between bins',
};

export function SyncConflictDetails({ entry, data }: { entry: OutboxEntry; data: WarehouseData | null }) {
  const input = entry.input;
  const fields: Array<[string, string]> = [];
  const add = (key: string, label: string, lookup?: (id: string) => string | undefined) => {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) fields.push([label, lookup?.(value) ?? value]);
    else if (typeof value === 'number' && Number.isFinite(value)) fields.push([label, String(value)]);
  };
  add('productId', 'Product', id => data?.products.find(item => item.id === id)?.name);
  for (const [key, label] of [['locationId', 'Warehouse'], ['fromLocationId', 'From warehouse'], ['toLocationId', 'To warehouse'], ['sourceLocationId', 'Source warehouse']] as const)
    add(key, label, id => data?.locations.find(item => item.id === id)?.name);
  for (const [key, label] of [['binId', 'Bin'], ['fromBinId', 'From bin'], ['toBinId', 'To bin'], ['sourceBinId', 'Source bin']] as const)
    add(key, label, id => data?.storageAreas.find(item => item.id === id)?.code);
  for (const [key, label] of [['poId', 'PO reference'], ['allocationId', 'Allocation reference'], ['quantity', 'Quantity'], ['serialNumber', 'Serial number']] as const) add(key, label);
  add('orderId', 'Order reference', id => data?.fulfillmentOrders.find(item => item.id === id)?.externalReference);
  const serials = Array.isArray(input.serialNumbers) ? input.serialNumbers.filter((value): value is string => typeof value === 'string') : [];
  const lines = Array.isArray(input.lines) ? input.lines.filter((line): line is Record<string, unknown> => !!line && typeof line === 'object') : [];
  return <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
    <h3 className="font-semibold text-ink">{ACTIONS[entry.method] ?? 'Queued stock change'}</h3>
    <p className="text-xs text-muted">Queued {Number.isNaN(Date.parse(entry.createdAt)) ? 'date unavailable' : new Date(entry.createdAt).toLocaleString('en-PH')}</p>
    <div className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-semibold">Why it needs attention</p>
      <p className="mt-1">{userFacingError(entry.error || 'The saved change could not be confirmed. Check the current record with your warehouse supervisor before trying again.')}</p>
    </div>
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-medium text-ink">{value}</dd></div>)}</dl>
    {serials.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">Selected serials ({serials.length})</summary><ul className="mt-2 space-y-1 text-sm">{serials.map((serial, i) => <li key={`${serial}-${i}`}>{serial}</li>)}</ul></details>}
    {lines.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">Selected lines ({lines.length})</summary><ul className="mt-2 space-y-3 text-sm">{lines.map((line, i) => <li key={i}>
      <p className="font-medium">{typeof line.productId === 'string' ? data?.products.find(product => product.id === line.productId)?.name ?? line.productId : `Line ${i + 1}`}</p>
      {(['quantity', 'expected', 'counted', 'batchNumber', 'lotCode', 'binId', 'serialNumber'] as const).map(key => {
        const value = line[key];
        const labels = { quantity: 'Quantity', expected: 'Expected count', counted: 'Actual count', batchNumber: 'Batch', lotCode: 'Lot', binId: 'Bin', serialNumber: 'Serial' };
        return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? <p key={key}>{labels[key]}: {String(value)}</p> : null;
      })}
      {Array.isArray(line.serialNumbers) && <p>Serials: {line.serialNumbers.filter(value => typeof value === 'string').join(', ')}</p>}
    </li>)}</ul></details>}
    <p className="text-xs text-muted">Queue reference: {entry.id}</p>
  </div>;
}
