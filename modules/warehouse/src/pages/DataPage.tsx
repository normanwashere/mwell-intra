import { useWarehouse } from '@/app/store';
import { toStockState } from '@/data/repository';
import {
  allocationsToCsv,
  inventoryToCsv,
  movementsToCsv,
} from '@/domain/export';
import { downloadText } from '@/app/download';
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
  { field: 'inventory_unit.status', type: 'enum', meaning: 'in_stock | allocated | issued | returned | lost.' },
  { field: 'movement.type', type: 'enum', meaning: 'receipt | issue | return | transfer | adjustment | cycle_count.' },
  { field: 'allocation.status', type: 'enum', meaning: 'reserved | allocated | issued | returned | cancelled.' },
  { field: 'movement.quantity', type: 'number', meaning: 'Signed quantity for the ledger entry.' },
];

const METRICS: { metric: string; formula: string }[] = [
  { metric: 'Available', formula: 'in_stock serialized units, or summed non-serialized stock levels.' },
  { metric: 'Return rate %', formula: 'round(returned / issued × 100, 1).' },
  { metric: 'Inventory value', formula: 'Σ on-hand × unit cost (by category).' },
  { metric: 'Days of cover', formula: 'available ÷ avg daily issued (lookback window).' },
  { metric: 'Inventory turnover', formula: 'issued in window ÷ average on-hand.' },
];

export function DataPage() {
  const { data } = useWarehouse();
  const toast = useToast();
  if (!data) return null;
  const state = toStockState(data);

  const exportCsv = (name: string, content: string) => {
    downloadText(name, content);
    toast.success(`Exported ${name}`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Data & Reports"
        icon="history"
        subtitle="Raw data access, definitions and metric logic"
      />

      <Card>
        <SectionTitle title="Raw data export" subtitle="CSV for reconciliation & BI tools" />
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            className="btn-outline justify-between"
            onClick={() => exportCsv('inventory.csv', inventoryToCsv(state))}
          >
            Inventory <Icon name="download" className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-outline justify-between"
            onClick={() => exportCsv('movements.csv', movementsToCsv(data.movements, data.products))}
          >
            Movements <Icon name="download" className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-outline justify-between"
            onClick={() =>
              exportCsv('allocations.csv', allocationsToCsv(data.allocations, data.products, data.events))
            }
          >
            Allocations <Icon name="download" className="h-4 w-4" />
          </button>
        </div>
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
          {METRICS.map((m) => (
            <li key={m.metric} className="py-2.5">
              <p className="text-sm font-semibold text-ink">{m.metric}</p>
              <p className="text-sm text-muted">{m.formula}</p>
            </li>
          ))}
        </ul>
      </Card>
      </div>
    </div>
  );
}
