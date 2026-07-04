import { clsx } from 'clsx';
import type { Product } from '@/domain/types';
import { Icon } from './Icon';

/** Maps a product to its catalog image by device/merchandise type. */
const IMAGE_BY_TYPE: Record<string, string> = {
  smart_watch: '/products/product-smartwatch.png',
  ecg_ring: '/products/product-ecg-ring.png',
  sleep_ring: '/products/product-sleep-ring.png',
  otg_bag: '/products/product-otg-bag.png',
  shirt: '/products/product-shirt.png',
  jacket: '/products/product-jacket.png',
  token: '/products/product-token.png',
};

export function productImage(
  product: Pick<Product, 'deviceType' | 'merchandiseType'>,
): string | null {
  const key = product.deviceType ?? product.merchandiseType;
  return key ? (IMAGE_BY_TYPE[key] ?? null) : null;
}

const SIZES = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-16 w-16',
} as const;

/** Square product thumbnail. Falls back to a category icon when no image. */
export function ProductThumb({
  product,
  size = 'md',
  className,
}: {
  product: Pick<Product, 'deviceType' | 'merchandiseType' | 'category' | 'name'>;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const src = productImage(product);
  return (
    <span
      className={clsx(
        'grid shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-black/5',
        SIZES[size],
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-full w-full object-contain p-1"
        />
      ) : (
        <Icon
          name={product.category === 'device' ? 'box' : 'tag'}
          className="h-5 w-5 text-faint"
        />
      )}
    </span>
  );
}
