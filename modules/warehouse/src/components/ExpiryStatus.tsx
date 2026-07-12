import { expiryRisk, type ExpiryRisk, type Lot, type Product } from '@intra/data-kit';
import { Badge } from '@/components/ui';

const PRIORITY: Record<ExpiryRisk, number> = {
  expired: 3,
  warning: 2,
  ok: 1,
  not_tracked: 0,
};

export interface ProductExpiryStatus {
  risk: Exclude<ExpiryRisk, 'not_tracked'>;
  expiryDate: string;
}

export function expiryStatusForProduct(
  product: Product | undefined,
  lots: Lot[],
  today = new Date().toISOString().slice(0, 10),
): ProductExpiryStatus | null {
  if (!product?.expiryTracked) return null;
  return lots
    .filter((lot) => lot.productId === product.id && lot.expiryDate)
    .map((lot) => ({
      risk: expiryRisk(lot.expiryDate, product.shelfLifeWarningDays ?? 30, today),
      expiryDate: lot.expiryDate!,
    }))
    .filter((status): status is ProductExpiryStatus => status.risk !== 'not_tracked')
    .sort((a, b) => PRIORITY[b.risk] - PRIORITY[a.risk] || a.expiryDate.localeCompare(b.expiryDate))[0] ?? null;
}

export function ExpiryBadge({ product, lots }: { product: Product; lots: Lot[] }) {
  const status = expiryStatusForProduct(product, lots);
  if (!status) return null;
  if (status.risk === 'expired') return <Badge tone="rose">Expired</Badge>;
  if (status.risk === 'warning') return <Badge tone="amber">Expires soon</Badge>;
  return <Badge tone="emerald">Shelf life OK</Badge>;
}
