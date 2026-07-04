import { useEffect, useState } from 'react';
import { useWarehouse } from '@/app/store';
import type { Product } from '@/domain/types';
import { Field, Sheet, money } from './ui';

/**
 * Bottom-sheet editor for a product's sell price. Shows landed cost and a live
 * margin preview. Gated by the caller (Pricing role only).
 */
export function PriceEditorSheet({
  product,
  open,
  onOpenChange,
}: {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { setProductPrice } = useWarehouse();
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open && product) setValue(product.price != null ? String(product.price) : '');
  }, [open, product]);

  if (!product) return null;

  const numeric = Number(value);
  const valid = value.trim() !== '' && !Number.isNaN(numeric) && numeric >= 0;
  const margin =
    valid && numeric > 0
      ? Math.round(((numeric - product.unitCost) / numeric) * 100)
      : null;

  const save = async () => {
    if (!valid) return;
    const ok = await setProductPrice({ productId: product.id, price: numeric });
    if (!ok) return;
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Set price"
      description={`${product.name} · ${product.sku}`}
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          disabled={!valid}
          onClick={() => void save()}
        >
          Save price
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-inset p-3">
            <p className="text-xs text-faint">Landed cost</p>
            <p className="tnum mt-0.5 text-lg font-bold text-ink">
              {money(product.unitCost)}
            </p>
          </div>
          <div className="rounded-xl bg-inset p-3">
            <p className="text-xs text-faint">Margin</p>
            <p
              className={
                margin == null
                  ? 'tnum mt-0.5 text-lg font-bold text-faint'
                  : margin >= 0
                    ? 'tnum mt-0.5 text-lg font-bold text-emerald-700 dark:text-emerald-300'
                    : 'tnum mt-0.5 text-lg font-bold text-rose-600 dark:text-rose-300'
              }
            >
              {margin == null ? '—' : `${margin}%`}
            </p>
          </div>
        </div>

        <Field
          label="Sell price (₱)"
          htmlFor="price-input"
          hint="Price charged per unit. Margin is vs landed cost."
        >
          <input
            id="price-input"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            className="input text-lg font-semibold"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={String(product.unitCost)}
          />
        </Field>
      </div>
    </Sheet>
  );
}
