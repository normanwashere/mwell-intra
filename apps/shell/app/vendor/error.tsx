'use client';

// Vendor portal boundary (spec §1, ADR-002 #3). External vendor sessions get
// the same recovery affordances as internal modules — retry the segment or
// return to their portal home (the dashboard resolves per profile.kind).

import { RouteErrorFallback } from '@shell/components/RouteErrorFallback';

export default function VendorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorFallback
      scope="vendor"
      title="Vendor portal couldn't load"
      subtitle="A page in the vendor portal failed to render."
      error={error}
      reset={reset}
      fullScreen
    />
  );
}
