import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkflowSummary } from '@intra/ui';
import type { CustomerReturnCase, InventoryHold, PageQuery, PageResult, QualityInspectionSummary } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { Icon } from '@/components/Icon';
import { loadCompleteControlQueue } from '@/domain/controlQueues';
import { returnWorkflowSummary } from '@/domain/workflowSummary';

type QualityRead = {
  scope: string;
  state: 'loading' | 'unavailable' | 'ready';
  inspections: QualityInspectionSummary[];
  holds: InventoryHold[];
  checkedAt?: string;
};

export function ReturnResolutionSummary({ record }: { record: CustomerReturnCase }) {
  const { data, source, identityId, capabilities, can, canOpenRoute, loadQualityInspectionSummaries, loadHolds } = useWarehouse();
  const canRead = can('inspect_quality') || can('release_quality_hold') || can('view_exceptions') || can('view_finance');
  const scope = JSON.stringify([source, identityId, record.id, record.sourceOrderId, record.productId, record.serialNumber, [...capabilities].sort()]);
  const [read, setRead] = useState<QualityRead>({ scope, state: 'loading', inspections: [], holds: [] });
  const [revision, setRevision] = useState(0);
  const loaders = useRef({ inspections: loadQualityInspectionSummaries, holds: loadHolds });
  loaders.current = { inspections: loadQualityInspectionSummaries, holds: loadHolds };
  const intakes = data?.returns.filter(item => item.returnCaseId === record.id && item.source === 'customer'
    && Boolean(record.sourceOrderId) && item.sourceOrderId === record.sourceOrderId) ?? [];
  const intake = intakes.length === 1 ? intakes[0] : undefined;

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useEffect(() => {
    if (!canRead || !intake) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setRead({ scope, state: 'loading', inspections: [], holds: [] });
    const complete = <T,>(load: (query: PageQuery) => Promise<PageResult<T>>) => loadCompleteControlQueue(async query => {
      if (!active) throw new Error('Quality read cancelled');
      const page = await load(query);
      if (!active) throw new Error('Quality read cancelled');
      return page;
    });
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Quality read timed out')), 12_000);
    });
    void Promise.race([Promise.all([complete(loaders.current.inspections), complete(loaders.current.holds)]), deadline])
      .then(([inspections, holds]) => {
        if (!active) return;
        // Only exact physical-intake lines establish this case's QC identity.
        const linked = inspections.filter(item => item.sourceType === 'return' && item.sourceId === intake.id
          && item.productId === record.productId && (item.serialNumber ?? '') === (record.serialNumber ?? '')
          && intake.lines.some(line => line.productId === item.productId && (line.serialNumber ?? '') === (item.serialNumber ?? '')
            && (line.binId ?? '') === (item.binId ?? '')));
        const ids = new Set(linked.map(item => item.id));
        if (ids.size !== linked.length) throw new Error('Duplicate inspection coverage is not verified');
        const linkedHolds = holds.filter(hold => ids.has(hold.inspectionId) && hold.productId === record.productId
          && (hold.serialNumber ?? '') === (record.serialNumber ?? ''));
        if (new Set(linkedHolds.map(hold => hold.id)).size !== linkedHolds.length) throw new Error('Duplicate hold records are not verified');
        setRead({ scope, state: 'ready', inspections: linked,
          holds: linkedHolds,
          checkedAt: new Date().toISOString() });
      }).catch(() => {
        if (active) setRead({ scope, state: 'unavailable', inspections: [], holds: [] });
      }).finally(() => { clearTimeout(timer); active = false; });
    return () => { active = false; clearTimeout(timer); };
  }, [scope, canRead, intake, revision, record.productId, record.serialNumber]);

  const current = read.scope === scope ? read : { ...read, state: 'loading' as const, inspections: [], holds: [] };
  const available = canRead && intake && current.state === 'ready';
  const activeHolds = available ? current.holds.filter(hold => hold.status === 'active') : [];
  const quantity = intake?.lines.filter(line => line.productId === record.productId && (line.serialNumber ?? '') === (record.serialNumber ?? ''))
    .reduce((sum, line) => sum + line.quantity, 0) ?? 0;
  const accepted = available && current.inspections.length > 0 && current.inspections.every(item => item.disposition === 'accepted')
    && current.inspections.every(item => Number.isFinite(item.quantity) && item.quantity > 0)
    && current.inspections.reduce((sum, item) => sum + item.quantity, 0) === quantity && quantity > 0
    && current.holds.every(hold => hold.status === 'released');
  const message = !canRead ? 'Your current access does not include Quality records. Quality clearance is not verified.'
    : !intake ? 'The exact linked physical intake is not available. Quality clearance is not verified.'
    : current.state === 'loading' ? 'Checking current Quality inspection and hold state...'
    : current.state === 'unavailable' ? 'Quality records could not be loaded. Quality clearance is not verified.'
    : activeHolds.length ? `${activeHolds.length} active hold${activeHolds.length === 1 ? '' : 's'} on this physical return. Quality clearance is blocked.`
    : accepted ? 'Quality inspection accepted; no active linked holds at the last check. Current stock availability remains subject to warehouse checks.'
    : current.inspections.length ? 'Quality review is pending or has a non-accepted disposition. Quality clearance is not verified.'
    : 'Current Quality hold or release status is not available in this view. Quality clearance is not verified.';

  return <>
    <WorkflowSummary {...returnWorkflowSummary(record, { returns: data?.returns, qualitySummary: message, qualityAccepted: Boolean(accepted) })} />
    <section aria-label="Current return quality" className="space-y-2 border-b border-line pb-3 text-sm [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">Current return quality</h3>
        {canRead && intake && <button type="button" className="btn-ghost btn-sm" title="Refresh return quality" aria-label="Refresh return quality"
          disabled={current.state === 'loading'} onClick={() => setRevision(value => value + 1)}><Icon name="rotate" className="h-4 w-4" /></button>}
      </div>
      <p role="status">{message}</p>
      {available && <>
        <p className="text-xs text-muted">Checked <time dateTime={current.checkedAt}>{new Date(current.checkedAt!).toLocaleString()}</time></p>
        <ul className="space-y-1">
          {current.inspections.map(item => <li key={item.id}>{canOpenRoute('quality')
            ? <Link className="inline-block min-h-11 py-3 underline" to={`/quality?inspection=${encodeURIComponent(item.id)}`}>Inspection {item.id}: {item.disposition.replaceAll('_', ' ')}</Link>
            : <span>Inspection {item.id}: {item.disposition.replaceAll('_', ' ')}</span>}</li>)}
          {current.holds.map(hold => <li key={hold.id}>{canOpenRoute('quality')
            ? <Link className="inline-block min-h-11 py-3 underline" to={`/quality?inspection=${encodeURIComponent(hold.id)}`}>Hold {hold.id}: {hold.status.replaceAll('_', ' ')}</Link>
            : <span>Hold {hold.id}: {hold.status.replaceAll('_', ' ')}</span>}</li>)}
        </ul>
      </>}
    </section>
  </>;
}
