import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import type { ReturnSource } from '@/domain/types';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  ProductSelect,
  QuantityStepper,
  SectionTitle,
  useToast,
} from '@/components/ui';
import { formatWhen, statusLabel } from '@/domain/format';
import type { Tone } from '@/components/ui';
import { EvidenceCapture } from '@/components/camera/EvidenceCapture';
import { BarcodeScanner } from '@/components/camera/BarcodeScanner';
import { EvidenceGallery } from '@/components/EvidenceGallery';

const DISPOSITION_META: Record<
  'restock' | 'lost' | 'vendor_return',
  { label: string; tone: Tone }
> = {
  restock: { label: 'Restocked', tone: 'emerald' },
  lost: { label: 'Written off', tone: 'rose' },
  vendor_return: { label: 'To vendor', tone: 'amber' },
};

// Stored values stay lowercase (existing data); labels render Title Case to
// match the rest of the module's copy (WH-20).
const REASONS: { value: string; label: string }[] = [
  { value: 'defective', label: 'Defective' },
  { value: 'wrong size', label: 'Wrong size' },
  { value: 'unused / surplus', label: 'Unused / surplus' },
  { value: 'damaged in transit', label: 'Damaged in transit' },
  { value: 'recall', label: 'Recall' },
  { value: 'other', label: 'Other' },
];

const DISPOSITIONS: { value: 'restock' | 'lost' | 'vendor_return'; label: string }[] = [
  { value: 'restock', label: 'Restock (back to available)' },
  { value: 'lost', label: 'Write off / lost' },
  { value: 'vendor_return', label: 'Return to vendor' },
];

export function ReturnsPage() {
  const { data, recordReturn } = useWarehouse();
  const toast = useToast();
  const [source, setSource] = useState<ReturnSource>('customer');
  const [eventId, setEventId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState(REASONS[0]!.value);
  const [disposition, setDisposition] = useState<'restock' | 'lost' | 'vendor_return'>(
    'restock',
  );
  const [serial, setSerial] = useState('');
  const [locationId, setLocationId] = useState('');
  const [binId, setBinId] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);

  if (!data) return null;
  const product = data.products.find((p) => p.id === productId);
  const productName = (id: string) =>
    data.products.find((p) => p.id === id)?.name ?? id;
  const restockLocations = data.locations.filter((l) => l.type !== 'vendor');
  const restockBins = (data.storageAreas ?? []).filter(
    (b) => b.locationId === locationId,
  );

  const submit = async () => {
    if (!productId) return;
    const ok = await recordReturn({
      source,
      eventId: eventId || undefined,
      evidenceUrls: evidence,
      lines: [
        {
          productId,
          quantity,
          reason,
          disposition,
          serialNumber: serial.trim() || undefined,
          locationId:
            disposition === 'restock' && locationId ? locationId : undefined,
          binId:
            disposition === 'restock' && locationId && binId ? binId : undefined,
        },
      ],
    });
    if (!ok) return;
    toast.success('Return logged in inspection staging');
    setQuantity(1);
    setSerial('');
    setEvidence([]);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Returns"
        icon="rotate"
        subtitle="Log customer & vendor returns with reasons"
      />

      <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Inspection required before putaway</p>
          <p className="text-xs opacity-80">Every physical return remains in quality staging until its condition is accepted.</p>
        </div>
        <Link to="/quality" className="btn-ghost btn-sm shrink-0 justify-center">Open quality queue</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Return source" htmlFor="ret-source">
            <select
              id="ret-source"
              className="input"
              value={source}
              onChange={(e) => setSource(e.target.value as ReturnSource)}
            >
              <option value="customer">Customer</option>
              <option value="vendor">Vendor</option>
            </select>
          </Field>
          <Field label="Related event (optional)" htmlFor="ret-event">
            <select
              id="ret-event"
              className="input"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">—</option>
              {data.events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Product" htmlFor="ret-product">
          <ProductSelect
            id="ret-product"
            products={data.products}
            value={productId}
            onChange={setProductId}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Quantity" htmlFor="ret-qty">
            <QuantityStepper
              id="ret-qty"
              aria-label="Quantity"
              value={quantity}
              onChange={setQuantity}
              min={1}
            />
          </Field>
          <Field label="Reason" htmlFor="ret-reason">
            <select
              id="ret-reason"
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Disposition"
          htmlFor="ret-disposition"
          hint="What happens to the returned stock"
        >
          <select
            id="ret-disposition"
            className="input"
            value={disposition}
            onChange={(e) =>
              setDisposition(e.target.value as 'restock' | 'lost' | 'vendor_return')
            }
          >
            {DISPOSITIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        {disposition === 'restock' && (
          <Field
            label="Restock into"
            htmlFor="ret-location"
            hint="Location the returned stock is added back to"
          >
            <select
              id="ret-location"
              className="input"
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                setBinId('');
              }}
            >
              <option value="">Auto (site holding stock)</option>
              {restockLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {disposition === 'restock' && locationId && restockBins.length > 0 && (
          <Field
            label="Restock bin"
            htmlFor="ret-bin"
            hint="Optional — the storage area the stock goes back into"
          >
            <select
              id="ret-bin"
              className="input"
              value={binId}
              onChange={(e) => setBinId(e.target.value)}
            >
              <option value="">General area (unassigned)</option>
              {restockBins.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                  {b.label ? ` · ${b.label}` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        {product?.serialized && (
          <Field
            label="Serial number"
            htmlFor="ret-serial"
            hint="Required to trace a serialized device"
          >
            <input
              id="ret-serial"
              className="input"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="e.g. ECG-RING-10-SN0001"
            />
            <div className="mt-2">
              <BarcodeScanner onDetected={setSerial} label="Scan serial" />
            </div>
          </Field>
        )}

        <EvidenceCapture onChange={setEvidence} label="Attach return evidence" />

        <button
          type="button"
          className="btn-primary w-full"
          disabled={!productId || (product?.serialized && !serial.trim())}
          onClick={() => void submit()}
        >
          Record return
        </button>
      </Card>

      <Card>
        <SectionTitle title="Recent returns" />
        {data.returns.length === 0 ? (
          <EmptyState icon="rotate" title="No returns recorded yet" />
        ) : (
          <ul className="space-y-2" aria-label="Returns">
            {data.returns
              .slice()
              .reverse()
              .map((r) => (
                <li key={r.id} className="rounded-xl bg-inset p-3">
                  <div className="flex items-center justify-between">
                    <Badge tone={r.source === 'vendor' ? 'brand' : 'cyan'}>
                      {r.source === 'vendor' ? 'Vendor' : 'Customer'}
                    </Badge>
                    <span className="text-xs text-faint">
                      {formatWhen(r.createdAt)}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-muted">
                    {r.lines.map((l, i) => (
                      <li key={i} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {l.quantity}× {productName(l.productId)} —{' '}
                          <span className="text-faint">{statusLabel(l.reason)}</span>
                        </span>
                        <Badge tone={DISPOSITION_META[l.disposition ?? 'restock'].tone}>
                          {DISPOSITION_META[l.disposition ?? 'restock'].label}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  {r.evidenceUrls && r.evidenceUrls.length > 0 && (
                    <div className="mt-2">
                      <EvidenceGallery urls={r.evidenceUrls} size="thumb" />
                    </div>
                  )}
                </li>
              ))}
          </ul>
        )}
      </Card>
      </div>
    </div>
  );
}
