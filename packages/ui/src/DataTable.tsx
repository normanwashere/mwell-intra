import { clsx } from 'clsx';
import type { KeyboardEvent, ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Hide this column in the mobile card layout. */
  hideOnMobile?: boolean;
  /** Use as the bold primary line of the mobile card. */
  primary?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  onRowClick?: (row: T) => void;
  ariaLabel?: string;
}

/**
 * Responsive data display: a real table on >= sm screens, and a stacked
 * card list on mobile (label/value pairs), so dense data stays legible on phones.
 */
export function DataTable<T>({
  columns,
  rows,
  keyOf,
  onRowClick,
  ariaLabel,
}: DataTableProps<T>) {
  const alignClass = (a?: string) =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  // Keyboard activation for non-native interactive rows (WCAG 2.1.1).
  const rowKeyDown = (row: T) => (e: KeyboardEvent) => {
    if (!onRowClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm" aria-label={ariaLabel}>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
              {columns.map((c) => (
                <th key={c.key} className={clsx('py-2 font-semibold', alignClass(c.align))}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr
                key={keyOf(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? rowKeyDown(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                className={clsx(
                  'text-ink',
                  onRowClick &&
                    'cursor-pointer transition hover:bg-inset focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500',
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={clsx('py-2.5 pr-2', alignClass(c.align))}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (aria-label kept on the table only to avoid duplicate
          accessible names when both layouts are present in the DOM). */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((row) => {
          const primary = columns.find((c) => c.primary);
          const rest = columns.filter((c) => !c.primary && !c.hideOnMobile);
          return (
            <li key={keyOf(row)}>
              <div
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? rowKeyDown(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                className={clsx(
                  'rounded-xl bg-inset p-3.5',
                  onRowClick &&
                    'cursor-pointer transition active:bg-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500',
                )}
              >
                {primary && (
                  <div className="mb-2 font-semibold text-ink">
                    {primary.render(row)}
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  {rest.map((c) => (
                    <div key={c.key} className="flex items-center justify-between gap-2">
                      <dt className="text-xs text-faint">{c.header}</dt>
                      <dd className="font-medium text-ink">{c.render(row)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
