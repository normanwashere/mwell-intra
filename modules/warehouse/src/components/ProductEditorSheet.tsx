import { useEffect, useState } from 'react';
import { useWarehouse } from '@/app/store';
import type { Product } from '@/domain/types';
import { Field, Sheet, useToast } from './ui';

/**
 * Bottom-sheet editor for a product master's editable fields (name, unit cost,
 * reorder point, barcode, promotional flag). Gated by the caller via the
 * `manage_products` capability. `unitCost` feeds valuation/landed cost; the
 * reorder point drives the procurement worklist & low-stock alerts.
 */
export function ProductEditorSheet({
  product,
  open,
  onOpenChange,
}: {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { updateProduct } = useWarehouse();
  const toast = useToast();
  const [name, setName] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reorderPoint, setReorderPoint] = useState('');
  const [barcode, setBarcode] = useState('');
  const [promotional, setPromotional] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && product) {
      setName(product.name);
      setUnitCost(String(product.unitCost));
      setReorderPoint(String(product.reorderPoint));
      setBarcode(product.barcode ?? '');
      setPromotional(Boolean(product.promotional));
      setError(null);
    }
  }, [open, product]);

  if (!product) return null;

  const save = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    const cost = Number(unitCost);
    const reorder = Number(reorderPoint);
    if (Number.isNaN(cost) || cost < 0) {
      setError('Unit cost must be zero or more.');
      return;
    }
    if (Number.isNaN(reorder) || reorder < 0) {
      setError('Reorder point must be zero or more.');
      return;
    }
    const ok = await updateProduct({
      productId: product.id,
      patch: {
        name: name.trim(),
        unitCost: cost,
        reorderPoint: reorder,
        barcode: barcode.trim(),
        promotional,
      },
    });
    if (!ok) return;
    toast.success(`Updated ${name.trim()}`);
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit product"
      description={`${product.name} · ${product.sku}`}
      footer={
        <button type="button" className="btn-primary w-full" onClick={() => void save()}>
          Save changes
        </button>
      }
    >
      <div className="space-y-3">
        <Field label="Name" htmlFor="pe-name" error={error ?? undefined}>
          <input
            id="pe-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit cost (₱)" htmlFor="pe-cost" hint="Landed cost per unit">
            <input
              id="pe-cost"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className="input"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </Field>
          <Field
            label="Reorder point"
            htmlFor="pe-reorder"
            hint="Replenish at/below this"
          >
            <input
              id="pe-reorder"
              type="number"
              inputMode="numeric"
              min={0}
              className="input"
              value={reorderPoint}
              onChange={(e) => setReorderPoint(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Barcode" htmlFor="pe-barcode">
          <input
            id="pe-barcode"
            className="input"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="EAN / UPC"
          />
        </Field>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded"
            checked={promotional}
            onChange={(e) => setPromotional(e.target.checked)}
          />
          <span className="text-sm text-muted">Promotional / give-away item</span>
        </label>
      </div>
    </Sheet>
  );
}
