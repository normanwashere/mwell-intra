// Sentry integration wrapper (spec extras).
//
// We deliberately do NOT hard-depend on @sentry/nextjs. Adding a required peer
// blocks the memory-mode / no-backend build, and Sentry's SDK pulls a lot of
// weight. Instead the client-side error boundary in `RouteErrorFallback` looks
// for a global `window.Sentry` and calls captureException if present.
//
// To wire real Sentry:
//   1. `pnpm --filter @intra/shell add @sentry/nextjs`
//   2. In apps/shell/app/layout.tsx (or a client provider) initialize Sentry
//      with NEXT_PUBLIC_SENTRY_DSN in a useEffect gated on the env var, and
//      attach the client to window.Sentry so RouteErrorFallback picks it up.
//
// Until then this file just documents the contract and exposes a no-op helper.

export function captureException(error: unknown): void {
  if (typeof window === 'undefined') return;
  const s = (window as unknown as { Sentry?: { captureException?: (e: unknown) => void } }).Sentry;
  try {
    s?.captureException?.(error);
  } catch {
    /* never let the reporter crash the app */
  }
}

export const SENTRY_ENABLED = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
