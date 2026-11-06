// No current live WMS runner has an approved history-preserving cleanup adapter.
// Retained fixtures, a finally block, or an operator flag do not establish readiness.
// Reopening requires reviewed source changes and exact-ID cleanup/residual proofs.
export function assertWmsLiveFixtureCleanupReady(mutationsRequested = true) {
  if (mutationsRequested === false) return;
  const error = new Error(
    'WMS_LIVE_FIXTURES_PAUSED: Live Warehouse fixture mutations are paused. '
    + 'History-preserving archival and independently verified zero active/unaccounted '
    + 'residue are not implemented for these runners. Do not seed, resume, or use '
    + 'existing master stock. Offline preparation and read-only checks remain available.',
  );
  error.code = 'WMS_LIVE_FIXTURES_PAUSED';
  throw error;
}
