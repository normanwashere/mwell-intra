'use client';

import { clsx } from 'clsx';
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Hide this column in the mobile card layout. */
  hideOnMobile?: boolean;
  /** Use as the bold primary line of the mobile card. */
  primary?: boolean;
  /** Enable client-side sort when the table is not controlled via sortKey. */
  sortable?: boolean;
  /** Extract a comparable value for sorting. Defaults to stringifying render output. */
  sortValue?: (row: T) => string | number;
}

export type DataTableDensity = 'comfortable' | 'compact';

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  onRowClick?: (row: T) => void;
  ariaLabel?: string;
  density?: DataTableDensity;
  /** Pin the header row while scrolling (desktop/tablet). */
  stickyHeader?: boolean;
  /** Controlled sort column key. */
  sortKey?: string | null;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (key: string, dir: 'asc' | 'desc') => void;
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
  density = 'comfortable',
  stickyHeader = true,
  sortKey: controlledSortKey,
  sortDir: controlledSortDir,
  onSortChange,
}: DataTableProps<T>) {
  const [localSortKey, setLocalSortKey] = useState<string | null>(null);
  const [localSortDir, setLocalSortDir] = useState<'asc' | 'desc'>('asc');

  const sortKey = controlledSortKey !== undefined ? controlledSortKey : localSortKey;
  const sortDir = controlledSortDir ?? localSortDir;

  const alignClass = (a?: string) =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  const cellPad = density === 'compact' ? 'py-1.5 pr-2' : 'py-2.5 pr-2';
  const headPad = density === 'compact' ? 'py-1.5' : 'py-2';

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortable) return rows;
    const get = col.sortValue ?? ((row: T) => {
      const v = col.render(row);
      return typeof v === 'string' || typeof v === 'number' ? v : String(v ?? '');
    });
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    const col = columns.find((c) => c.key === key);
    if (!col?.sortable) return;
    const nextDir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc';
    if (onSortChange) {
      onSortChange(key, nextDir);
    } else {
      setLocalSortKey(key);
      setLocalSortDir(nextDir);
    }
  };

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
      <div className="hidden min-w-0 max-w-full overflow-hidden rounded-2xl border border-line bg-surface sm:block">
        <div
          className="max-w-full overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          role="region"
          aria-label={`${ariaLabel ?? 'Data table'} horizontal scroll area`}
          tabIndex={0}
        >
          <table className="w-full min-w-max text-sm" aria-label={ariaLabel}>
            <thead
              className={clsx(
                stickyHeader && 'sticky top-0 z-[1] bg-surface/95 backdrop-blur-sm',
              )}
            >
              <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                {columns.map((c) => {
                  const active = sortKey === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      className={clsx(
                        headPad,
                        'font-semibold',
                        alignClass(c.align),
                        c.sortable && 'select-none',
                      )}
                    >
                      {c.sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={clsx(
                            'inline-flex min-h-11 items-center gap-1 py-1 transition hover:text-ink sm:min-h-8',
                            active && 'text-ink',
                          )}
                          aria-sort={
                            active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                          }
                        >
                          {c.header}
                          <Icon
                            name="chevron"
                            className={clsx(
                              'h-3 w-3 transition',
                              active && sortDir === 'desc' && 'rotate-180',
                              !active && 'opacity-40',
                            )}
                          />
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sortedRows.map((row, i) => (
                <tr
                  key={keyOf(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? rowKeyDown(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'button' : undefined}
                  className={clsx(
                    'text-ink',
                    i % 2 === 1 && 'bg-inset/40',
                    onRowClick &&
                      'cursor-pointer transition hover:bg-brand-500/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500',
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={clsx(cellPad, alignClass(c.align))}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <ul className="min-w-0 max-w-full space-y-2 sm:hidden">
        {sortedRows.map((row) => {
          const primary =
            columns.find((c) => c.primary) ??
            columns.find((c) => !c.hideOnMobile);
          const rest = columns.filter(
            (c) => c !== primary && !c.hideOnMobile,
          );
          return (
            <li key={keyOf(row)} className="min-w-0 max-w-full">
              <div
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? rowKeyDown(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                className={clsx(
                  'card max-w-full overflow-hidden p-3.5',
                  onRowClick &&
                    'cursor-pointer transition active:bg-inset focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500',
                )}
              >
                {primary && (
                  <div className="mb-2 flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1 break-words font-display text-base font-bold leading-snug text-ink">
                      {primary.render(row)}
                    </div>
                    {onRowClick && (
                      <span
                        aria-hidden
                        className="mt-0.5 shrink-0 text-faint"
                      >
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                    )}
                  </div>
                )}
                <dl className="space-y-1.5 text-sm">
                  {rest.map((c) => (
                    <div
                      key={c.key}
                      className="flex min-w-0 items-baseline justify-between gap-3"
                    >
                      <dt className="shrink-0 text-xs uppercase tracking-wide text-faint">
                        {c.header}
                      </dt>
                      <dd className="min-w-0 break-words text-right font-medium text-ink">
                        {c.render(row)}
                      </dd>
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
