import type { ReactNode } from 'react';

export function AdminHeader({ title, action }: { title: string; action?: ReactNode }) {
  return <header className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
    <h1 className="min-w-0 break-words text-2xl font-bold text-ink">{title}</h1>
    {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
  </header>;
}

export function AdminSections({ items }: { items: readonly { id: string; label: string }[] }) {
  return <nav aria-label="Page sections" className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line">
    {items.map(item => <a key={item.id} href={`#${item.id}`}
      className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2"
      onClick={() => document.getElementById(item.id)?.focus({ preventScroll: true })}>{item.label}</a>)}
  </nav>;
}
