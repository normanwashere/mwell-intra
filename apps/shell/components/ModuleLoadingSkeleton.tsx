// Full-screen skeleton for chromeless module segments (spec §1, dead-end
// prevention polish). The warehouse/procurement/legal/vendor mounts skip the
// suite AppShell (see ChromeGate), so their `loading.tsx` needs to paint the
// full viewport shape themselves — sidebar rail on desktop, top bar, and a
// content column that mirrors the eventual module chrome closely enough to
// avoid a layout jump when the dynamic import resolves.

import { Skeleton, SkeletonList, SkeletonStats } from '@intra/ui';

export interface ModuleLoadingSkeletonProps {
  /** Screen-reader label announced during the load. */
  label?: string;
}

export function ModuleLoadingSkeleton({
  label = 'Loading module…',
}: ModuleLoadingSkeletonProps) {
  return (
    <div
      className="min-h-screen bg-app md:flex"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>

      {/* Desktop sidebar rail */}
      <aside className="hidden w-60 shrink-0 flex-col bg-brand-grad px-3 py-5 md:flex lg:w-64">
        <Skeleton className="mb-6 h-6 w-32 bg-white/20" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-xl bg-white/15" />
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="safe-top sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Skeleton className="h-5 w-32" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-14 rounded-full" />
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-5 pb-24 sm:px-6 md:pb-10 xl:max-w-6xl">
          <div className="space-y-3">
            <Skeleton className="h-7 w-2/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
          <SkeletonStats />
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonList rows={5} />
            <SkeletonList rows={5} />
          </div>
        </main>

        {/* Mobile bottom nav rail */}
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur md:hidden">
          <div className="flex items-center justify-around px-2 py-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-12 rounded-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
