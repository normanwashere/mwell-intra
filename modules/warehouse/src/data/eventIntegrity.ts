import { useEffect, useState } from 'react';
import { useSession } from '@intra/auth';

interface CustodyTotals {
  reserved: number;
  issued: number;
  returned: number;
  outstanding: number;
}
interface EventOutcomes {
  status: string;
  sold: number;
  giveaway: number;
  returned: number;
  lost: number;
  damaged: number;
  rekit: number;
}

/** Read-only event-bound projections; never substitute an empty result for a failed read. */
export function useEventIntegrity(eventId: string, refreshToken?: unknown) {
  const { mode, supabaseClient } = useSession();
  const [state, setState] = useState<{ eventId: string; custody?: CustodyTotals; outcomes?: EventOutcomes; error?: string }>({ eventId });
  useEffect(() => {
    if (mode !== 'supabase' || !supabaseClient || !eventId) return;
    let active = true;
    setState({ eventId });
    void (async () => {
      try {
        const custody = await supabaseClient.schema('warehouse').from('event_custody_totals')
          .select('reserved_units,issued_units,returned_units,outstanding_units').eq('event_id', eventId).single();
        if (custody.error || !custody.data) throw new Error('Event custody unavailable');
        const outcomes = await supabaseClient.schema('warehouse').from('event_reconciliations')
          .select('status,sold_units,giveaway_units,returned_units,lost_units,damaged_units,rekit_units').eq('event_id', eventId).maybeSingle();
        const row = custody.data;
        const result: typeof state = { eventId, custody: { reserved: Number(row.reserved_units), issued: Number(row.issued_units), returned: Number(row.returned_units), outstanding: Number(row.outstanding_units) } };
        if (outcomes.error) result.error = 'Reconciliation outcomes unavailable';
        else if (outcomes.data) {
          const o = outcomes.data;
          result.outcomes = { status: o.status, sold: Number(o.sold_units), giveaway: Number(o.giveaway_units), returned: Number(o.returned_units), lost: Number(o.lost_units), damaged: Number(o.damaged_units), rekit: Number(o.rekit_units) };
        }
        if (active) setState(result);
      } catch (cause) {
        if (active) setState({ eventId, error: cause instanceof Error ? cause.message : 'Event custody unavailable' });
      }
    })();
    return () => { active = false; };
  }, [mode, supabaseClient, eventId, refreshToken]);
  return { live: mode === 'supabase', ...(state.eventId === eventId ? state : { eventId }) };
}
