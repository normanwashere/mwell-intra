'use client';

// Global route error boundary (spec §1). Catches unhandled render errors from
// pages that live directly under the suite chrome (dashboard, /login,
// /reset-password). Module segments have their own boundaries so a warehouse
// crash doesn't blank the whole shell.

import { RouteErrorFallback } from '@shell/components/RouteErrorFallback';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorFallback
      scope="root"
      title="Mwell Intra hit a snag"
      subtitle="This part of the app couldn't render. You can retry safely — nothing has been saved."
      error={error}
      reset={reset}
    />
  );
}
