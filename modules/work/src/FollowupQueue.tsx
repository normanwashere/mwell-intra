'use client';
import { userFacingError } from '@intra/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@intra/auth';
import type { WorkView } from './workView';

export interface Followup {
  id: string; metric_id: string; area: string; reason_code: string; status: string; can_act: boolean;
  acknowledged_by?: string; acknowledged_at?: string; resolved_by?: string; resolved_at?: string; resolution_reference?: string;
}
export function FollowupQueue({ view = 'all', source = 'all', search = '' }: { view?: WorkView | 'all'; source?: string; search?: string }) {
  const { supabaseClient, mode, profile } = useSession();
  const [items, setItems] = useState<Followup[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [outcome, setOutcome] = useState<{ id:string; resolved:boolean } | null>(null);
  const lock = useRef(false);
  const [references, setReferences] = useState<Record<string,string>>({});
  const refresh = useCallback(async () => {
    if (mode !== 'supabase' || !supabaseClient) { setLoading(false); return; }
    setLoading(true);
    try {
      const all: Followup[] = [];
      let after: string | null = null;
      for (;;) {
        const result = await supabaseClient.schema('core').rpc('platform_followup_page', {p_after: after});
        if (result.error) throw result.error;
        const page = result.data as Followup[];
        if (!Array.isArray(page)) throw new Error('Follow-up queue unavailable');
        all.push(...page);
        if (page.length < 100) break;
        const next = page[page.length-1]!.id;
        if (after && next <= after) throw new Error('Follow-up paging did not advance');
        after = next;
      }
      setItems(all); setError('');
    } catch (cause) { setError((cause as Error).message || 'Follow-up queue unavailable'); }
    finally { setLoading(false); }
  }, [supabaseClient, mode, profile?.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function transition(item: Followup) {
    if (!supabaseClient || lock.current) return;
    lock.current = true; setBusy(item.id);
    try {
      const result = await supabaseClient.schema('core').rpc('platform_transition_followup', {payload: {
        id: item.id, action: item.status === 'open' ? 'acknowledge' : 'resolve', resolution_reference: references[item.id]?.trim(),
      }});
      if (result.error) throw result.error;
      setOutcome({ id:item.id, resolved:item.status !== 'open' });
      await refresh();
    } catch (cause) { setError((cause as Error).message || 'Follow-up could not be updated'); }
    finally { lock.current = false; setBusy(''); }
  }
  if (mode !== 'supabase' || !['all', 'insights'].includes(source)) return null;
  const visible = items.filter(item => {
    const directLink = typeof window !== 'undefined' && window.location.hash === `#followup-${item.id}`;
    const matchesView = view === 'all' || (view === 'completed' ? item.status === 'resolved' : item.status !== 'resolved' && (view === 'action' ? item.can_act : !item.can_act));
    return directLink || (matchesView && `${item.metric_id} ${item.area} ${item.reason_code} ${item.status}`.toLowerCase().includes(search.trim().toLowerCase()));
  });
  return <section aria-label="Leadership follow-ups" className="space-y-3 border-t border-line pt-4">
    <h2 className="text-lg font-semibold">Leadership follow-ups</h2>
    {outcome && <p role="status" className="text-sm text-ink">{outcome.resolved ? 'Follow-up resolved. The result is saved in completed work.' : 'Follow-up acknowledged. Add the resolution reference when the work is finished.'} <a className="font-semibold underline" href={`/work?view=${outcome.resolved ? 'completed' : 'action'}#followup-${encodeURIComponent(outcome.id)}`}>View follow-up</a></p>}
    {loading && <p role="status">Loading follow-ups...</p>}
    {error && <p role="alert">{userFacingError(error)} <button className="btn-outline" onClick={() => void refresh()}>Retry follow-ups</button></p>}
    {!loading && !error && !visible.length && <p>No matching follow-ups in your scope.</p>}
    {visible.map(item => <article id={`followup-${item.id}`} key={item.id} className="scroll-mt-24 border-b border-line py-3 space-y-2 [overflow-wrap:anywhere]">
      <h3 className="font-semibold">{item.metric_id} / {item.area}</h3>
      <p>{item.reason_code} / {item.status}</p>
      {item.acknowledged_at && <p>Acknowledged by {item.acknowledged_by} at {item.acknowledged_at}</p>}
      {item.resolved_at && <p>Resolved by {item.resolved_by} at {item.resolved_at}: {item.resolution_reference}</p>}
      {item.can_act && item.status !== 'resolved' && <>
        {item.status === 'acknowledged' && <label className="block">Resolution record reference<input className="input block w-full" value={references[item.id] ?? ''} maxLength={200} onChange={event => setReferences({...references,[item.id]:event.target.value})} /></label>}
        <button className="btn-primary" disabled={Boolean(busy) || (item.status === 'acknowledged' && (references[item.id]?.trim().length ?? 0) < 6)} onClick={() => void transition(item)}>{busy === item.id ? 'Saving...' : item.status === 'open' ? 'Acknowledge' : 'Resolve'}</button>
      </>}
    </article>)}
  </section>;
}
