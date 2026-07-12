'use client';

// Shared recovery UI for App Router `error.tsx` boundaries (spec §1, dead-end
// prevention polish). Every boundary logs to console.error so runtime failures
// surface during development, and — if a Sentry global has been installed on
// window — mirrors the error via `captureException`. The UI stays close to the
// EmptyState pattern used elsewhere in the shell so recovery feels familiar.

import { useEffect } from 'react';
import Link from 'next/link';
import { EmptyState, Icon, PageHeader } from '@intra/ui';

type SentryLike = {
  captureException?: (err: unknown) => void;
};

type SentryHost = typeof window & { Sentry?: SentryLike };

function reportError(scope: string, error: Error & { digest?: string }) {
  console.error(`[intra:shell] ${scope} boundary caught error`, error);
  if (typeof window === 'undefined') return;
  const host = window as SentryHost;
  try {
    host.Sentry?.captureException?.(error);
  } catch {
    // Never let error reporting itself surface an error.
  }
  void fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    keepalive: true,
    body: JSON.stringify({
      scope,
      digest: error.digest,
      route: window.location.pathname,
    }),
  }).catch(() => undefined);
}

export interface RouteErrorFallbackProps {
  /** Short label describing which module/segment threw (e.g. "warehouse"). */
  scope: string;
  /** Human-friendly title shown at the top of the recovery card. */
  title: string;
  /** Subtitle under the title; short, plain English. */
  subtitle: string;
  /** Error object handed to the boundary by Next. */
  error: Error & { digest?: string };
  /** Reset callback provided by Next; retries the failed segment. */
  reset: () => void;
  /** When true the recovery UI is centered on a full-screen surface (module chromeless routes). */
  fullScreen?: boolean;
}

export function RouteErrorFallback({
  scope,
  title,
  subtitle,
  error,
  reset,
  fullScreen = false,
}: RouteErrorFallbackProps) {
  useEffect(() => {
    reportError(scope, error);
  }, [scope, error]);

  const body = (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState
        icon="alert"
        title="Something went wrong"
        message={
          error.digest
            ? `We logged the error (reference ${error.digest}). Try again, or head back to your dashboard.`
            : 'We logged the error. Try again, or head back to your dashboard.'
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="btn-primary"
            >
              <Icon name="rotate" className="h-4 w-4" />
              Try again
            </button>
            <Link href="/" className="btn-outline">
              <Icon name="grid" className="h-4 w-4" />
              Back to dashboard
            </Link>
          </div>
        }
      />
    </div>
  );

  if (!fullScreen) return body;

  return (
    <div className="grid min-h-screen place-items-center bg-app">{body}</div>
  );
}
