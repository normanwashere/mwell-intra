import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import { toStockState } from '@/data/repository';
import {
  allocationsToCsv,
  inventoryToCsv,
  movementsToCsv,
} from '@/domain/export';
import type { WarehouseExportKind } from '@/domain/export';
import { downloadText, downloadUrl } from '@/app/download';
import { prepareWarehouseExport } from '@/app/governedExports';
import { warehouseMetrics } from '@intra/data-kit';
import {
  Badge,
  Card,
  PageHeader,
  SectionTitle,
  useToast,
} from '@/components/ui';
import { Icon } from '@/components/Icon';

const DICTIONARY: { field: string; type: string; meaning: string }[] = [
  { field: 'product.sku', type: 'string', meaning: 'Unique stock-keeping unit code.' },
  { field: 'product.serialized', type: 'boolean', meaning: 'Whether each unit has a unique serial.' },
  { field: 'inventory_unit.status', type: 'enum', meaning: 'in_stock | allocated | issued | returned | vendor_return | lost.' },
  { field: 'movement.type', type: 'enum', meaning: 'receipt | issue | return | vendor_return | transfer | adjustment | cycle_count.' },
  { field: 'allocation.status', type: 'enum', meaning: 'reserved | allocated | issued | returned | cancelled.' },
  { field: 'movement.quantity', type: 'number', meaning: 'Signed quantity for the ledger entry.' },
];

export function DataPage() {
  const { data, source } = useWarehouse();
  const toast = useToast();
  const [exporting, setExporting] = useState<WarehouseExportKind | null>(null);
  if (!data) return null;
  const state = toStockState(data);

  const exportCsv = async (kind: WarehouseExportKind, content: string) => {
    setExporting(kind);
    try {
      const prepared = await prepareWarehouseExport({ source, kind, demoContent: content });
      if (prepared.downloadUrl) downloadUrl(prepared.filename, prepared.downloadUrl);
      else downloadText(prepared.filename, prepared.demoContent ?? '');
      toast.success(
        source === 'memory'
          ? `Downloaded demo export ${prepared.filename}`
          : `Recorded and downloaded ${prepared.filename}`,
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Export failed.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Data & Reports"
        icon="history"
        subtitle="Raw data access, definitions and metric logic"
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <Link to="/reports" className="btn-primary justify-center">Open inventory reports</Link>
        <Link to="/exceptions" className="btn-outline justify-center">Open exception register</Link>
      </div>

      <Card>
        <SectionTitle title="Raw data export" subtitle="CSV for reconciliation & BI tools" />
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            className="btn-outline justify-between"
            disabled={exporting !== null}
            onClick={() => void exportCsv('inventory', inventoryToCsv(state))}
          >
            {exporting === 'inventory' ? 'Preparing...' : 'Inventory'} <Icon name="download" className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-outline justify-between"
            disabled={exporting !== null}
            onClick={() => void exportCsv('movements', movementsToCsv(data.movements, data.products))}
          >
            {exporting === 'movements' ? 'Preparing...' : 'Movements'} <Icon name="download" className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-outline justify-between"
            disabled={exporting !== null}
            onClick={() =>
              void exportCsv('allocations', allocationsToCsv(data.allocations, data.products, data.events))
            }
          >
            {exporting === 'allocations' ? 'Preparing...' : 'Allocations'} <Icon name="download" className="h-4 w-4" />
          </button>
          {source === 'supabase' && (
            <>
              <button
                type="button"
                className="btn-outline justify-between"
                disabled={exporting !== null}
                onClick={() => void exportCsv('inventory_position', '')}
              >
                Inventory position <Icon name="download" className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-outline justify-between"
                disabled={exporting !== null}
                onClick={() => void exportCsv('quality', '')}
              >
                Quality <Icon name="download" className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-outline justify-between"
                disabled={exporting !== null}
                onClick={() => void exportCsv('cycle_counts', '')}
              >
                Cycle counts <Icon name="download" className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        <p className="mt-3 text-xs text-faint">
          {source === 'memory'
            ? 'Demo exports stay on this device and are not audit evidence.'
            : 'Live exports are checksummed, logged, stored privately, and downloaded with a short-lived link.'}
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card>
        <SectionTitle title="Data dictionary" subtitle="Field definitions & types" />
        <ul className="divide-y divide-line" aria-label="Data dictionary">
          {DICTIONARY.map((d) => (
            <li key={d.field} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5">
              <span className="font-mono text-sm text-brand-600 dark:text-brand-300">{d.field}</span>
              <Badge tone="slate">{d.type}</Badge>
              <span className="w-full text-sm text-muted sm:w-auto sm:flex-1">{d.meaning}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle title="Metric definitions" subtitle="Calculation logic for consistency" />
        <ul className="divide-y divide-line" aria-label="Metric definitions">
          {warehouseMetrics.map((metric) => (
            <li key={metric.id} className="space-y-1 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">{metric.label}</p>
                <Badge tone="slate">{metric.owner}</Badge>
              </div>
              <p className="text-sm text-muted">{metric.formula}</p>
              <p className="text-xs text-faint">
                {metric.timeBasis} · {metric.sourceFields.join(', ')}
              </p>
              {metric.limitation && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {metric.limitation}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>
      </div>
    </div>
  );
}
