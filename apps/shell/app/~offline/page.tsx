export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
        Offline
      </p>
      <h1 className="font-display text-2xl font-bold text-ink">
        You&apos;re offline
      </h1>
      <p className="text-sm text-muted">
        Mwell Intra is unavailable without a network connection. Reconnect to
        sync warehouse changes from the outbox.
      </p>
    </main>
  );
}
