"use client";

import { useEffect, useRef, useState } from 'react';
import { useSession } from '@intra/auth';
import { Field, Icon, PageHeader, userFacingError } from '@intra/ui';
import { eventCapabilityAllowed } from './capabilities';

type Allocation = { allocation_id: string; product_id: string; serialized: boolean; issued_units: number; returned_units: number;
  sold_units: number; giveaway_units: number; remaining_units: number; eligible_serials: string[] };
type Entry = { id: string; kind: string; allocation_id: string; seller_id: string; quantity: number; amount: number;
  external_reference: string; serial_numbers: string[]; reverses_id?: string; created_at: string };
type Ledger = { enabled: boolean; may_configure: boolean; event_status: string; event_name?: string; allocations: Allocation[]; entries: Entry[];
  readiness?: { schema: boolean; capabilities: boolean; learning: boolean; ready: boolean };
  totals: { sold_units: number; giveaway_units: number; gross_sales_amount: number }; next_offset: number | null;
  sellers: Array<{ user_id: string; full_name: string; email: string; valid_until: string; revoked_at: string | null }> };
type ScopedEvent = { id: string; name: string; status: string };

export function EventCustodyWorkspace({ eventId, embedded = false }: { eventId?: string; embedded?: boolean }) {
  const { profile, mode, supabaseClient, userRoles, userCapabilities } = useSession();
  const [events, setEvents] = useState<ScopedEvent[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sellerEmail, setSellerEmail] = useState('');
  const [reversal, setReversal] = useState<Entry | null>(null);
  const [draft, setDraft] = useState({ allocation_id: '', kind: 'sale', quantity: 1, amount: '', external_reference: '', serial_numbers: [] as string[], reason: '' });
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const busy = useRef(false);
  const live = mode === 'supabase' ? supabaseClient : null;
  const mayRecord = eventCapabilityAllowed(userRoles, 'record_event_outcome', mode, userCapabilities?.events);
  const allocation = ledger?.allocations.find(row => row.allocation_id === draft.allocation_id);
  const isClosed = ['closed', 'cancelled'].includes(ledger?.event_status ?? '');

  useEffect(() => {
    if (!live || !profile) return;
    let cancelled = false;
    setLoading(true); setError('');
    const request = eventId ? live.schema('warehouse').rpc('event_custody_ledger', { payload: { event_id: eventId, offset } })
      : live.schema('warehouse').rpc('my_event_custody_events', { payload: {} });
    void Promise.resolve(request).then(({ data, error: failure }) => {
      if (cancelled) return;
      if (failure) { setError(userFacingError(failure)); setLedger(null); return; }
      if (eventId) setLedger(data as unknown as Ledger); else setEvents((data ?? []) as unknown as ScopedEvent[]);
    }).catch(cause => { if (!cancelled) setError(userFacingError(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [live, profile?.id, eventId, revision, offset]);

  async function command(name: string, payload: Record<string, unknown>) {
    if (!live || !eventId || busy.current) return;
    const scoped = { event_id: eventId, ...payload };
    const fingerprint = JSON.stringify({ name, scoped });
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, key: crypto.randomUUID() };
    busy.current = true; setSaving(true); setError('');
    try {
      const { error: failure } = await live.schema('warehouse').rpc(name, { payload: { ...scoped, idempotency_key: intent.current.key } });
      if (failure) throw failure;
      intent.current = null; setReversal(null);
      setDraft(current => ({ ...current, quantity: 1, amount: '', external_reference: '', serial_numbers: [], reason: '' }));
      setOffset(0); setRevision(value => value + 1);
    } catch (cause) { setError(userFacingError(cause)); }
    finally { busy.current = false; setSaving(false); }
  }

  return <section className="min-w-0 space-y-4 border-y border-line py-4" aria-label="Event sales custody">
    {embedded ? <h2 className="text-lg font-semibold">Event custody ledger</h2> : <PageHeader title="Event sales" icon="calendar" />}
    {!live ? <p role="status">A connected account is required to record event outcomes.</p> : <>
      {error && <div role="alert" className="space-y-2 text-sm text-rose-700"><p>{error}</p>
        <p>After assignment expiry, contact the event owner for governed correction review.</p>
        <button type="button" className="btn-outline" disabled={saving || loading} onClick={() => setRevision(value => value + 1)}><Icon name="rotate" className="h-4 w-4" /> Retry read</button></div>}
      {loading && <p role="status">Loading event custody...</p>}
      {!eventId && !loading && <ul className="divide-y divide-line">{events.map(event => <li key={event.id} className="py-3">
        <a className="flex min-h-11 items-center justify-between gap-3 font-semibold" href={`/events/${encodeURIComponent(event.id)}`}><span className="break-words">{event.name}</span><Icon name="chevron" className="h-4 w-4 shrink-0" /></a>
      </li>)}{events.length === 0 && !error && <li className="space-y-1 py-3 text-sm text-muted">
        <p className="font-semibold text-ink">No current event assignment.</p>
        <p>Ask your event coordinator to assign your account to the event. Only your active event assignments appear here.</p>
      </li>}</ul>}
      {ledger && <>
        {!embedded && ledger.event_name && <h2 className="text-lg font-semibold">{ledger.event_name}</h2>}
        <dl className="grid grid-cols-3 gap-3 text-sm" aria-label="Recorded outcome totals">
          <div><dt>Sales</dt><dd className="font-semibold tabular-nums">{ledger.totals.sold_units}</dd></div>
          <div><dt>Giveaways</dt><dd className="font-semibold tabular-nums">{ledger.totals.giveaway_units}</dd></div>
          <div><dt>Sales amount (PHP)</dt><dd className="break-words font-semibold tabular-nums">{Number(ledger.totals.gross_sales_amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</dd></div>
        </dl>
        {!ledger.enabled && <p role="status" className="text-sm text-muted">Event custody is not enabled.</p>}
        {ledger.may_configure && <fieldset disabled={saving || loading} className="min-w-0 space-y-3 border-y border-line py-3">
          <legend className="text-sm font-semibold">Event custody setup</legend>
          <ul className="text-sm" aria-label="Custody rollout prerequisites">
            <li>Server schema: {ledger.readiness?.schema ? 'ready' : 'pending'}</li>
            <li>Seller capabilities: {ledger.readiness?.capabilities ? 'ready' : 'pending'}</li>
            <li>Learning publication: {ledger.readiness?.learning ? 'ready' : 'pending'}</li>
          </ul>
          <button type="button" className="btn-outline" disabled={isClosed || (!ledger.enabled && !ledger.readiness?.ready)} onClick={() => void command('configure_event_custody', { action: ledger.enabled ? 'disable' : 'enable' })}>
            <Icon name="lock" className="h-4 w-4" /> {ledger.enabled ? 'Disable seller posting' : 'Enable prospective custody'}</button>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1"><Field label="Named seller account email" htmlFor="event-seller-email"><input id="event-seller-email" type="email" className="input" value={sellerEmail} onChange={e => setSellerEmail(e.target.value)} /></Field></div>
            <button type="button" className="btn-outline" disabled={!ledger.enabled || !sellerEmail.trim()} onClick={() => void command('configure_event_custody', { action: 'assign', seller_email: sellerEmail.trim() })}><Icon name="plus" className="h-4 w-4" /> Assign seller</button>
          </div>
          <ul className="divide-y divide-line text-sm">{ledger.sellers?.map(seller => <li key={seller.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 break-words">{seller.full_name} ({seller.email}){seller.revoked_at ? ' - Revoked' : ` - Until ${new Date(seller.valid_until).toLocaleString()}`}</span>
            {!seller.revoked_at && <button type="button" className="btn-ghost" onClick={() => void command('configure_event_custody', { action: 'revoke', user_id: seller.user_id })}>Revoke</button>}
          </li>)}</ul>
        </fieldset>}
        <ul className="divide-y divide-line text-sm" aria-label="Remaining event allocations">{ledger.allocations.map(row => <li key={row.allocation_id} className="space-y-1 py-3">
          <p className="break-words font-semibold">{row.product_id}</p>
          <p>Issued {row.issued_units}; sold {row.sold_units}; giveaways {row.giveaway_units}; returned {row.returned_units}; remaining {row.remaining_units}</p>
        </li>)}</ul>
        {ledger.enabled && !isClosed && ledger.allocations.length === 0 && <div role="status" className="space-y-1 border-l-4 border-brand-500 bg-inset px-4 py-3 text-sm">
          <p className="font-semibold">No stock is ready to record yet.</p>
          <p>Warehouse must release the stock and the recipient must acknowledge receipt before it appears here. Ask your event coordinator to check the linked fulfillment order.</p>
        </div>}
        {!mayRecord && userRoles.events?.includes('seller') && <p role="status" className="text-sm">Seller posting is locked. <a className="underline" href={`/onboarding?requirement=internal.role.events.seller.custody-practice.v1&next=${encodeURIComponent(`/events/${eventId}`)}`}>Open required learning</a></p>}
        {mayRecord && ledger.enabled && !isClosed && <form className="min-w-0 space-y-3" onSubmit={event => {
          event.preventDefault(); void command('record_event_outcome', reversal
            ? { kind: 'reversal', allocation_id: reversal.allocation_id, reverses_id: reversal.id, external_reference: draft.external_reference, reason: draft.reason }
            : { ...draft, quantity: allocation?.serialized ? draft.serial_numbers.length : draft.quantity, amount: draft.kind === 'giveaway' ? 0 : Number(draft.amount) });
        }}>
          <fieldset disabled={saving || loading} className="min-w-0 space-y-3">
            <legend className="text-sm font-semibold">{reversal ? `Reverse ${reversal.external_reference}` : 'Record own outcome'}</legend>
            {!reversal && <>
              <Field label="Issued allocation" htmlFor="event-sale-allocation"><select id="event-sale-allocation" className="input" required value={draft.allocation_id} onChange={e => setDraft(current => ({ ...current, allocation_id: e.target.value, serial_numbers: [] }))}>
                <option value="">Select an allocation</option>{ledger.allocations.map(row => <option key={row.allocation_id} value={row.allocation_id} disabled={row.remaining_units <= 0}>{row.product_id} - {row.remaining_units} remaining</option>)}
              </select></Field>
              <Field label="Outcome" htmlFor="event-sale-kind"><select id="event-sale-kind" className="input" value={draft.kind} onChange={e => setDraft(current => ({ ...current, kind: e.target.value }))}><option value="sale">Sale</option><option value="giveaway">Giveaway</option></select></Field>
              {allocation?.serialized ? <fieldset className="max-h-48 space-y-1 overflow-y-auto"><legend className="text-sm font-semibold">Eligible serials</legend>{allocation.eligible_serials.map(serial => <label key={serial} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.serial_numbers.includes(serial)} onChange={event => setDraft(current => ({ ...current, serial_numbers: event.target.checked ? [...current.serial_numbers, serial] : current.serial_numbers.filter(value => value !== serial) }))} />{serial}
              </label>)}</fieldset> : <Field label="Quantity" htmlFor="event-sale-quantity"><input id="event-sale-quantity" type="number" className="input" min="1" step="1" required max={allocation?.remaining_units ?? 0} value={draft.quantity} onChange={e => setDraft(current => ({ ...current, quantity: Number(e.target.value) }))} /></Field>}
              {draft.kind === 'sale' && <Field label="Total sales amount (PHP)" htmlFor="event-sale-amount"><input id="event-sale-amount" type="number" className="input" min="0.01" step="0.01" required value={draft.amount} onChange={e => setDraft(current => ({ ...current, amount: e.target.value }))} /></Field>}
            </>}
            <Field label="External reference" htmlFor="event-sale-reference"><input id="event-sale-reference" className="input" required maxLength={120} value={draft.external_reference} onChange={e => setDraft(current => ({ ...current, external_reference: e.target.value }))} /></Field>
            {reversal && <Field label="Correction reason" htmlFor="event-sale-reason"><textarea id="event-sale-reason" className="input" required value={draft.reason} onChange={e => setDraft(current => ({ ...current, reason: e.target.value }))} /></Field>}
            <div className="flex flex-wrap gap-2"><button className="btn-primary" type="submit" disabled={!reversal && (!allocation || (allocation.serialized && draft.serial_numbers.length === 0))}><Icon name="check" className="h-4 w-4" />{saving ? 'Recording...' : reversal ? 'Record reversal' : 'Record outcome'}</button>
              {reversal && <button type="button" className="btn-outline" onClick={() => setReversal(null)}>Cancel</button>}</div>
          </fieldset>
        </form>}
        <ul className="divide-y divide-line text-sm" aria-label="Event outcome history">{ledger.entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="min-w-0"><p className="break-words font-semibold">{entry.external_reference}</p><p>{entry.kind}: {entry.quantity}; PHP {Number(entry.amount).toFixed(2)}</p><p className="break-words text-muted">{entry.serial_numbers.join(', ')}</p></div>
          {entry.kind !== 'reversal' && entry.seller_id === profile?.id && mayRecord && !isClosed && ledger.enabled && <button type="button" className="btn-ghost" disabled={saving} onClick={() => { setReversal(entry); setDraft(current => ({ ...current, external_reference: '', reason: '' })); }}><Icon name="rotate" className="h-4 w-4" /> Reverse</button>}
        </li>)}</ul>
        <nav className="flex gap-2" aria-label="Ledger pages">
          {offset > 0 && <button className="btn-outline" disabled={loading || saving} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button>}
          {ledger.next_offset != null && <button className="btn-outline" disabled={loading || saving} onClick={() => setOffset(ledger.next_offset!)}>Next</button>}
        </nav>
      </>}
    </>}
  </section>;
}
