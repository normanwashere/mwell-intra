'use client';

// Legal module boundary (spec §1). Internal legal_reviewer / compliance / admin
// users land here when a screen crashes; vendor-tier users have their own
// `/vendor` boundary sibling.

import { RouteErrorFallback } from '@shell/components/RouteErrorFallback';

export default function LegalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorFallback
      scope="legal"
      title="Legal module couldn't load"
      subtitle="A screen in the legal module failed to render."
      error={error}
      reset={reset}
      fullScreen
    />
  );
}
