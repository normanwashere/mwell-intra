import { Icon, userFacingError } from '@intra/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InventoryPosition } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { prepareWarehouseExport } from '@/app/governedExports';
import { useCanPrepareWarehouseExport } from '@/auth/useCanPrepareWarehouseExport';
import { useSession } from '@/auth/session';
import { downloadText, downloadUrl } from '@/app/download';
import { toCsv } from '@/domain/export';
import { loadCompleteControlQueue } from '@/domain/controlQueues';
import { positionAvailable, productPositionSummaries } from '@/domain/inventoryPositionSummary';
import { DataTable, EmptyState, Field, PageHeader, SectionTitle, type Column } from '@/components/ui';

const PAGE_SIZE = 50;

export function ReportsPage() {
  const { data, source, identityId, capabilities, loadInventoryPositions } = useWarehouse();
  const canExport = useCanPrepareWarehouseExport(source);
  const { loading: sessionLoading } = useSession();
  const loader = useRef(loadInventoryPositions);
  useEffect(() => { loader.current = loadInventoryPositions; });
  const sequence = useRef(0);
  const accessScope = [...capabilities].sort().join('|');
  const [positions, setPositions] = useState<InventoryPosition[]>([]);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(0);
  const [locationId, setLocationId] = useState('all');
  const [productId, setProductId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const current = ++sequence.current;
    const load = loader.current;
    setLoading(true);
    setReady(false);
    setPositions([]);
    setPage(0);
    setExportReady(false);
    setError('');
    if (!data) return;
    try {
      // PageQuery has no location/product predicates. Filter only after all
      // caller-scoped pages arrive, never over a silently truncated first page.
      const complete = await loadCompleteControlQueue(query => {
        if (current !== sequence.current) throw new Error('Report load cancelled.');
        return load(query);
      });
      if (current !== sequence.current) return;
      setPositions(complete);
      setReady(true);
    } catch (cause) {
      if (current === sequence.current) setError(cause instanceof Error ? cause.message : 'Report could not be loaded.');
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [data, source, identityId, accessScope]);
  useEffect(() => { void reload(); return () => { sequence.current += 1; }; }, [reload]);

  const rows = useMemo(() => positions.filter((position) =>
    (locationId === 'all' || position.locationId === locationId) &&
    (productId === 'all' || position.productId === productId)), [locationId, positions, productId]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const exportDisabledReason = loading || (source === 'supabase' && sessionLoading)
    ? 'Export is unavailable while inventory or access is loading.'
    : !canExport
      ? 'You can view this report, but your current access does not allow inventory exports. Ask an authorized colleague to prepare the export.'
      : !ready ? 'Export is unavailable until the report loads successfully.' : undefined;
  if (!data) return null;
  const productName = (id: string) => data.products.find((product) => product.id === id)?.name ?? id;
  const locationName = (id: string) => data.locations.find((location) => location.id === id)?.name ?? id;
  const binName = (id?: string) => id ? data.storageAreas.find((bin) => bin.id === id)?.code ?? id : 'General';
  const totals = rows.reduce((sum, row) => ({
    onHand: sum.onHand + row.onHand, committed: sum.committed + row.committed,
    held: sum.held + row.held, unavailable: sum.unavailable + row.unavailable,
  }), { onHand: 0, committed: 0, held: 0, unavailable: 0 });
  const products = productPositionSummaries(rows, source);
  const sumConfirmed = (values: (number | null)[]) => values.some(value => value === null)
    ? null : values.reduce<number>((sum, value) => sum + value!, 0);
  const missingLiveSummary = source === 'supabase' && rows.length === 0;
  const available = missingLiveSummary ? null : locationId === 'all'
    ? sumConfirmed([...products.values()].map(summary => summary.available))
    : sumConfirmed(rows.map(row => products.get(row.productId)?.available == null ? null : positionAvailable(row, source)));
  const unscoped = missingLiveSummary ? null : sumConfirmed([...products.values()].map(summary => summary.unscopedCommitted));
  const unassigned = [...products].filter(([, summary]) => (summary.unscopedCommitted ?? 0) > 0);
  const availableAtPosition = (row: InventoryPosition) => products.get(row.productId)?.available == null
    ? null : positionAvailable(row, source);
  const columns: Column<InventoryPosition>[] = [
    { key: 'product', header: 'Product', primary: true, render: (row) => productName(row.productId) },
    { key: 'location', header: 'Location', render: (row) => locationName(row.locationId) },
    { key: 'bin', header: 'Bin', render: (row) => binName(row.binId) },
    ...(['onHand', 'committed', 'held', 'unavailable'] as const).map((key) => ({
      key, header: key === 'onHand' ? 'On hand' : key[0]!.toUpperCase() + key.slice(1), align: 'right' as const,
      render: (row: InventoryPosition) => <span className="tabular-nums font-semibold">{row[key]}</span>,
    })),
    { key: 'available', header: 'Available', align: 'right', render: row => {
      const value = availableAtPosition(row);
      return value === null ? <span className="block text-sm font-medium text-ink">Not confirmed
        {(row.unscopedCommitted ?? 0) > 0 && <span className="block text-xs text-muted">Unassigned demand</span>}
      </span> : <span className="tabular-nums font-semibold">{value}</span>;
    } },
  ];

  const exportReport = async () => {
    if (!canExport || exporting || loading || !ready) return;
    setExporting(true); setError(''); setExportReady(false);
    try {
      const content = toCsv(rows.map((row) => ({
        product: productName(row.productId), location: locationName(row.locationId), bin: binName(row.binId),
        onHand: row.onHand, committed: row.committed, held: row.held,
        unavailable: row.unavailable, available: availableAtPosition(row) ?? '',
        unscopedCommitted: row.unscopedCommitted ?? '', productAvailable: products.get(row.productId)?.available ?? '',
        availabilityVerified: availableAtPosition(row) !== null ? 'true' : 'false', putawayAvailable: row.putawayAvailable ?? '',
        productTotalsScope: 'Repeated per product; count once per product',
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
      {error && <div role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
        <p>{userFacingError(error)}</p>
        {!ready && !loading && <button type="button" className="btn-outline mt-2" onClick={() => void reload()}><Icon name="rotate" />Retry loading report</button>}
      </div>}
      <div className="grid min-w-0 gap-3 border-y border-line py-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] [&>div]:min-w-0">
        <Field label="Location filter" htmlFor="report-location"><select id="report-location" className="input" value={locationId} onChange={(event) => { setLocationId(event.target.value); setPage(0); }}><option value="all">All locations</option>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
        <Field label="Product filter" htmlFor="report-product"><select id="report-product" className="input" value={productId} onChange={(event) => { setProductId(event.target.value); setPage(0); }}><option value="all">All products</option>{data.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
        <button type="button" className="btn-primary self-end justify-center" disabled={!canExport || exporting || loading || !ready} aria-describedby={exportDisabledReason ? 'report-export-reason' : undefined} onClick={() => void exportReport()}><Icon name="download" />{exporting ? 'Preparing...' : source === 'supabase' ? 'Export full inventory' : 'Export report'}</button>
      </div>
      {exportDisabledReason && <p id="report-export-reason" className="text-sm text-muted">{exportDisabledReason}</p>}
      {source === 'supabase' && <p className="text-sm text-muted">Filters apply to this view; export includes all authorized positions.</p>}
      {exportReady && <p role="status" className="rounded-lg bg-emerald-500/10 p-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">Export ready. The private download link expires shortly; request a new export for corrections.</p>}
      {ready && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Inventory position totals">
        {Object.entries(totals).map(([key, value]) => <div key={key} className="min-w-0 rounded-lg bg-inset p-3"><dt className="text-xs capitalize text-faint">{key === 'onHand' ? 'On hand' : key === 'committed' ? 'Scoped committed' : key}</dt><dd className="mt-1 text-xl font-bold tabular-nums text-ink">{value}</dd></div>)}
        <div className="min-w-0 rounded-lg bg-inset p-3"><dt className="text-xs text-faint">{locationId === 'all' ? 'Available (all locations)' : 'Available (selected location)'}</dt><dd aria-label="Available total" className="mt-1 text-lg font-bold tabular-nums text-ink">{available ?? 'Not confirmed'}</dd></div>
        <div className="min-w-0 rounded-lg bg-inset p-3"><dt className="text-xs text-faint">Unassigned commitment (product-wide)</dt><dd aria-label="Unassigned commitment total" className="mt-1 text-lg font-bold tabular-nums text-ink">{unscoped ?? 'Not confirmed'}</dd></div>
      </dl>}
      {ready && unassigned.length > 0 && <section aria-label="Unassigned product commitments" className="border-y border-line py-3">
        <h2 className="text-sm font-semibold text-ink">Unassigned product commitments</h2>
        <ul className="mt-2 space-y-2 text-sm text-ink">{unassigned.map(([id, summary]) => <li key={id} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 break-words">{productName(id)} <span className="text-muted">{data.products.find(product => product.id === id)?.sku ?? id}</span></span>
          <span className="font-medium tabular-nums">{summary.unscopedCommitted} - location not assigned</span>
        </li>)}</ul>
      </section>}
      <section aria-labelledby="committed-report-title" className="min-w-0">
        <SectionTitle id="committed-report-title" title="Committed report" subtitle={ready ? `${rows.length} position row(s)` : undefined} />
        {loading ? <p role="status" className="text-sm text-muted">Loading inventory positions...</p> : !ready ? null : rows.length === 0 ? <EmptyState icon="box" title="No positions match these filters" /> : <>
          <DataTable columns={columns} rows={visibleRows} keyOf={(row) => `${row.productId}|${row.locationId}|${row.binId ?? ''}`} ariaLabel="Inventory position report" density="compact" />
          <nav aria-label="Report pages" className="mt-3 flex items-center justify-end gap-3">
            <button type="button" className="btn-ghost h-11 w-11 shrink-0 justify-center p-0" aria-label="Previous page" title="Previous page" disabled={page === 0} onClick={() => setPage(value => value - 1)}><Icon name="chevron" className="h-4 w-4 rotate-180" /></button>
            <span aria-live="polite" className="text-sm tabular-nums text-muted">Page {page + 1} of {pageCount}</span>
            <button type="button" className="btn-ghost h-11 w-11 shrink-0 justify-center p-0" aria-label="Next page" title="Next page" disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}><Icon name="chevron" className="h-4 w-4" /></button>
          </nav>
        </>}
      </section>
    </div>
  );
}
