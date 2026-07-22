import type { Product } from '@/domain/types';
import { Sheet, money } from './ui';

/**
 * Warehouse keeps price and landed-cost context read-only. Every revision is
 * proposed and independently approved in the Product governance workspace.
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
  if (!product) return null;

  const currentPrice = product.price ?? 0;
  const margin =
    currentPrice > 0
      ? Math.round(((currentPrice - product.unitCost) / currentPrice) * 100)
      : null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Pricing governance"
      description={`${product.name} · ${product.sku}`}
      footer={
        <a
          className="btn-primary min-h-11 w-full"
          href={`/product/pricing?productId=${encodeURIComponent(product.id)}`}
        >
          Open governed pricing
        </a>
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
            <p className="text-xs text-faint">Current price</p>
            <p className="tnum mt-0.5 text-lg font-bold text-ink">
              {money(currentPrice)}
            </p>
          </div>
          <div className="rounded-xl bg-inset p-3">
            <p className="text-xs text-faint">Current margin</p>
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

        <p className="rounded-xl border border-line bg-surface p-3 text-sm text-muted">
          Price revisions require an effective date, cost basis, reason, and
          independent approval in Product.
        </p>
      </div>
    </Sheet>
  );
}
