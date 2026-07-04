// Global route-loading fallback (spec §1). Rendered inside the RootLayout tree,
// so the ChromeGate/AppShell surrounds this skeleton for chromeful routes and
// leaves it full-width for chromeless module transitions that don't yet own a
// closer `loading.tsx`. Kept lightweight — content-area skeletons only — so it
// blends into whichever surface it lands in.

import { Skeleton, SkeletonList, SkeletonStats } from '@intra/ui';

export default function Loading() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-live="polite"
      aria-label="Loading page…"
    >
      <span className="sr-only">Loading page…</span>
      <div className="space-y-3">
        <Skeleton className="h-7 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <SkeletonStats />
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonList rows={5} />
        <SkeletonList rows={5} />
      </div>
    </div>
  );
}
