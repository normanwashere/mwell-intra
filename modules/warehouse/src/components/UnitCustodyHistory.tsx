import { useEffect, useState } from 'react';
import { useSession } from '@/auth/session';
import { formatWhen, statusLabel } from '@/domain/format';

interface State { location_id?: string; bin_id?: string; status?: string }
interface Entry {
  id: string; operation: 'registered' | 'changed' | 'removed'; recorded_at: string;
  before_state: State | null; after_state: State | null;
}

export function UnitCustodyHistory({ unitId, locationName, binName }: {
  unitId: string; locationName: (id: string) => string; binName: (id?: string) => string;
}) {
  const { mode, supabaseClient } = useSession();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { setEntries([]); setCursor(null); }, [unitId]);
  useEffect(() => {
    if (mode !== 'supabase' || !supabaseClient) return;
    let active = true;
    setLoading(true); setError(false);
    void (async () => {
      try {
        const result = await supabaseClient.schema('warehouse').rpc('unit_custody_history', {
          p_unit_id: unitId, p_before_id: cursor,
        });
        if (result.error || !Array.isArray(result.data)) throw new Error('History unavailable');
        const rows = result.data as Entry[];
        if (active) {
          setEntries(previous => cursor ? [...previous, ...rows.slice(0, 50)] : rows.slice(0, 50));
          setHasMore(rows.length > 50);
        }
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [mode, supabaseClient, unitId, cursor, retry]);
  if (mode !== 'supabase') return null;
  const describe = (state: State | null) => state
    ? `${state.status ? statusLabel(state.status) : 'Recorded'} - ${state.location_id ? locationName(state.location_id) : 'No location'} / ${binName(state.bin_id)}`
    : 'Not registered';
  return <section aria-label="Verified unit custody" className="mb-4 space-y-3 border-b border-line pb-4">
    <h3 className="font-semibold text-ink">Verified unit custody</h3>
    {loading && <p role="status" className="text-sm text-muted">Loading unit history...</p>}
    {error && <div role="alert" className="text-sm text-rose-700 dark:text-rose-300">Unit history could not be loaded. <button type="button" className="btn-ghost" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {!loading && !error && entries.length === 0 && <p className="text-sm text-muted">No unit-specific custody changes have been recorded since tracking began. Older product totals do not identify this serial.</p>}
    <ol className="space-y-3">
      {entries.map(entry => <li key={entry.id} className="border-l-2 border-brand-300 pl-3 text-sm">
        <p className="font-semibold text-ink">{entry.operation === 'registered' ? 'Unit registered' : entry.operation === 'removed' ? 'Unit record removed' : 'Custody updated'}</p>
        {entry.before_state && <p className="break-words text-muted">From: {describe(entry.before_state)}</p>}
        {entry.after_state && <p className="break-words text-ink">To: {describe(entry.after_state)}</p>}
        <time className="text-xs text-faint" dateTime={entry.recorded_at}>{formatWhen(entry.recorded_at)}</time>
      </li>)}
    </ol>
    {hasMore && !error && <button type="button" disabled={loading} className="btn-ghost" onClick={() => setCursor(entries.at(-1)?.id ?? null)}>Older custody changes</button>}
  </section>;
}
