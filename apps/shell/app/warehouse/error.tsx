'use client';

// Warehouse module boundary (spec §1). The warehouse module owns its own
// chrome, so this fallback fills the viewport and keeps the "Back to dashboard"
// door open rather than trapping the user inside a broken sub-tree.

import { RouteErrorFallback } from '@shell/components/RouteErrorFallback';

export default function WarehouseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorFallback
      scope="warehouse"
      title="Warehouse module couldn't load"
      subtitle="A tool in the warehouse module failed to render."
      error={error}
      reset={reset}
      fullScreen
    />
  );
}
