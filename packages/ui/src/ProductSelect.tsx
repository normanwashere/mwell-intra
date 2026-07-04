'use client';

import { useMemo } from 'react';

/**
 * Minimal shape this control needs to render an option. The warehouse `Product`
 * domain type is a superset of this, so it plugs in directly without @intra/ui
 * depending on the domain package (kept decoupled for Step 1a).
 */
export interface ProductSelectItem {
  id: string;
  name: string;
  sku: string;
}

/** A group of variants that share a family (e.g. all sizes of "ECG Ring"). */
export interface ProductFamily<T> {
  key: string;
  label: string;
  variants: T[];
}

interface ProductSelectProps<T extends ProductSelectItem> {
  products: T[];
  value: string;
  onChange: (productId: string) => void;
  id?: string;
  placeholder?: string;
  /** Include a leading empty option. */
  includeBlank?: boolean;
  className?: string;
  'aria-label'?: string;
  /**
   * Optional family grouping (e.g. `groupProductsByFamily` from the domain
   * layer). When omitted the products render as a flat list.
   */
  groupBy?: (products: T[]) => ProductFamily<T>[];
  /** Label for a variant inside a multi-variant family. Defaults to `name`. */
  variantLabel?: (product: T) => string;
}

/**
 * A native select that (optionally) groups products by family via an injected
 * `groupBy` function. Native semantics keep it accessible and testable.
 */
export function ProductSelect<T extends ProductSelectItem>({
  products,
  value,
  onChange,
  id,
  placeholder = 'Select a product…',
  includeBlank = true,
  className = 'input',
  'aria-label': ariaLabel,
  groupBy,
  variantLabel,
}: ProductSelectProps<T>) {
  const families = useMemo<ProductFamily<T>[]>(
    () =>
      groupBy
        ? groupBy(products)
        : products.map((p) => ({ key: p.id, label: p.name, variants: [p] })),
    [products, groupBy],
  );

  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {includeBlank && <option value="">{placeholder}</option>}
      {families.map((fam) => {
        const [first] = fam.variants;
        if (fam.variants.length === 1 && first) {
          return (
            <option key={fam.key} value={first.id}>
              {first.name}
            </option>
          );
        }
        return (
          <optgroup key={fam.key} label={fam.label}>
            {fam.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {variantLabel ? variantLabel(v) : v.name} · {v.sku}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
