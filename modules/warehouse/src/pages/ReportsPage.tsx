import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InventoryPosition } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { prepareWarehouseExport } from '@/app/governedExports';
import { downloadText, downloadUrl } from '@/app/download';
import { toCsv } from '@/domain/export';
import { Card, DataTable, EmptyState, Field, PageHeader, SectionTitle, type Column } from '@/components/ui';

export function ReportsPage() {
  const { data, source, loadInventoryPositions } = useWarehouse();
  const [positions, setPositions] = useState<InventoryPosition[]>([]);
  const [locationId, setLocationId] = useState('all');
  const [productId, setProductId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setPositions((await loadInventoryPositions({ limit: 100 })).rows); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Report could not be loaded.'); }
    finally { setLoading(false); }
  }, [loadInventoryPositions]);
  useEffect(() => { void reload(); }, [reload]);

  const rows = useMemo(() => positions.filter((position) =>
    (locationId === 'all' || position.locationId === locationId) &&
    (productId === 'all' || position.productId === productId)), [locationId, positions, productId]);
  if (!data) return null;
  const productName = (id: string) => data.products.find((product) => product.id === id)?.name ?? id;
  const locationName = (id: string) => data.locations.find((location) => location.id === id)?.name ?? id;
  const binName = (id?: string) => id ? data.storageAreas.find((bin) => bin.id === id)?.code ?? id : 'General';
  const totals = rows.reduce((sum, row) => ({
    onHand: sum.onHand + row.onHand, committed: sum.committed + row.committed,
    held: sum.held + row.held, unavailable: sum.unavailable + row.unavailable,
    available: sum.available + row.available,
  }), { onHand: 0, committed: 0, held: 0, unavailable: 0, available: 0 });
  const columns: Column<InventoryPosition>[] = [
    { key: 'product', header: 'Product', primary: true, render: (row) => productName(row.productId) },
    { key: 'location', header: 'Location', render: (row) => locationName(row.locationId) },
    { key: 'bin', header: 'Bin', render: (row) => binName(row.binId) },
    ...(['onHand', 'committed', 'held', 'unavailable', 'available'] as const).map((key) => ({
      key, header: key === 'onHand' ? 'On hand' : key[0]!.toUpperCase() + key.slice(1), align: 'right' as const,
      render: (row: InventoryPosition) => <span className="tabular-nums font-semibold">{row[key]}</span>,
    })),
  ];

  const exportReport = async () => {
    setExporting(true); setError(''); setExportReady(false);
    try {
      const content = toCsv(rows.map((row) => ({
        product: productName(row.productId), location: locationName(row.locationId), bin: binName(row.binId),
        onHand: row.onHand, committed: row.committed, held: row.held,
        unavailable: row.unavailable, available: row.available,
      })));
      const prepared = await prepareWarehouseExport({ source, kind: 'inventory_position', demoContent: content });
      if (prepared.downloadUrl) downloadUrl(prepared.filename, prepared.downloadUrl);
      else downloadText(prepared.filename, prepared.demoContent ?? '');
      setExportReady(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Export failed.'); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Inventory position report" icon="history" subtitle="On-hand, commitments, holds, unavailable, and available stock" />
      {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <Card className="grid gap-3 sm:grid-cols-3">
        <Field label="Location filter" htmlFor="report-location"><select id="report-location" className="input" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="all">All locations</option>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
        <Field label="Product filter" htmlFor="report-product"><select id="report-product" className="input" value={productId} onChange={(event) => setProductId(event.target.value)}><option value="all">All products</option>{data.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
        <button type="button" className="btn-primary self-end justify-center" disabled={exporting || loading} onClick={() => void exportReport()}>{exporting ? 'Preparing...' : 'Export report'}</button>
      </Card>
      {exportReady && <p role="status" className="rounded-lg bg-emerald-500/10 p-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">Export ready. The private download link expires shortly; request a new export for corrections.</p>}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Inventory position totals">
        {Object.entries(totals).map(([key, value]) => <div key={key} className="rounded-lg bg-inset p-3"><dt className="text-xs capitalize text-faint">{key === 'onHand' ? 'On hand' : key}</dt><dd className="mt-1 text-xl font-bold tabular-nums text-ink">{value}</dd></div>)}
      </dl>
      <Card>
        <SectionTitle title="Committed report" subtitle={`${rows.length} position row(s) · maximum 100 per request`} />
        {loading ? <p className="text-sm text-muted">Loading inventory positions...</p> : rows.length === 0 ? <EmptyState icon="box" title="No positions match these filters" /> : <DataTable columns={columns} rows={rows} keyOf={(row) => `${row.productId}|${row.locationId}|${row.binId ?? ''}`} ariaLabel="Inventory position report" density="compact" />}
      </Card>
    </div>
  );
}
