'use client';

import { Icon } from '@intra/ui';
import type { TechnologyQualification, TechnologyVendorPool } from '../types';
import { TECHNOLOGY_VENDOR_POOLS } from '../requirements/vendorAccreditationV2025';

const LABELS: Record<TechnologyVendorPool, string> = {
  nodejs: 'Vendor Pool 1: NodeJS expertise',
  php_laravel: 'Vendor Pool 2: PHP Laravel expertise',
  mobile: 'Vendor Pool 3: Mobile app development expertise',
};

export function TechnologyQualificationForm({
  value,
  onChange,
  readOnly = false,
}: {
  value: TechnologyQualification[];
  onChange: (value: TechnologyQualification[]) => void;
  readOnly?: boolean;
}) {
  function update(pool: TechnologyVendorPool, patch: Partial<TechnologyQualification>) {
    const current = value.find((row) => row.pool === pool) ?? {
      pool,
      qualified: false,
      remarks: '',
    };
    onChange([...value.filter((row) => row.pool !== pool), { ...current, ...patch }]);
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {(Object.keys(TECHNOLOGY_VENDOR_POOLS) as TechnologyVendorPool[]).map((pool) => {
        const row = value.find((item) => item.pool === pool);
        return (
          <section key={pool} className="rounded-lg border border-line bg-inset/40 p-4">
            <label className="flex min-h-11 items-center gap-3 font-semibold text-ink">
              <input
                type="checkbox"
                checked={row?.qualified ?? false}
                disabled={readOnly}
                onChange={(event) => update(pool, { qualified: event.target.checked })}
                className="h-5 w-5 rounded border-line text-brand-600"
              />
              {LABELS[pool]}
            </label>
            <ul className="mt-3 space-y-1.5 text-xs text-muted">
              {TECHNOLOGY_VENDOR_POOLS[pool].map((requirement) => (
                <li key={requirement} className="flex gap-2">
                  <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{requirement}</span>
                </li>
              ))}
            </ul>
            <label className="mt-4 block text-xs font-semibold text-ink">
              Remarks
              <textarea
                value={row?.remarks ?? ''}
                disabled={readOnly}
                onChange={(event) => update(pool, { remarks: event.target.value })}
                rows={3}
                className="input mt-1.5"
                placeholder="References, certifications, or reviewer notes"
              />
            </label>
          </section>
        );
      })}
    </div>
  );
}
