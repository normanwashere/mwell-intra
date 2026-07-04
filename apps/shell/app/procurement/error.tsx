'use client';

// Procurement module boundary (spec §1). Mirrors the warehouse boundary shape
// so recovery feels identical no matter which module tripped.

import { RouteErrorFallback } from '@shell/components/RouteErrorFallback';

export default function ProcurementError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorFallback
      scope="procurement"
      title="Procurement module couldn't load"
      subtitle="A screen in the procurement module failed to render."
      error={error}
      reset={reset}
      fullScreen
    />
  );
}
