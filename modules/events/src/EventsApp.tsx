'use client';

import { useMemo, useState } from 'react';
import { useSession } from '@intra/auth';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  HeroChipButton,
  Icon,
  ModuleHero,
  Sheet,
  SignInPrompt,
  SkeletonList,
  SkeletonStats,
  StatCard,
  useToast,
} from '@intra/ui';
import { canAccessEvents, canCreateEvents } from './access';
import { useEventsData, validateEventDraft } from './data';
import type { EventDraft, EventLifecycle } from './types';

const TYPE_OPTIONS = [
  ['corporate', 'Corporate'],
  ['government_lgu', 'Government / LGU'],
  ['medical_mission', 'Medical mission'],
  ['vip_activation', 'VIP activation'],
  ['b2c', 'B2C'],
  ['b2b', 'B2B'],
] as const;

const LIFECYCLE_TONE: Record<EventLifecycle, 'brand' | 'emerald' | 'slate'> = {
  planned: 'brand',
  active: 'emerald',
  completed: 'slate',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`));
}

export function EventsApp({
  eventId,
  openCreate = false,
}: {
  eventId?: string;
  openCreate?: boolean;
}) {
  const { profile, userRoles, loading: sessionLoading } = useSession();
  const { data, loading, error, refresh, createEvent } = useEventsData();
  const toast = useToast();
  const [open, setOpen] = useState(openCreate);
  const [draft, setDraft] = useState<EventDraft>({ name: '', type: 'corporate', startDate: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const summary = useMemo(() => ({
    planned: data.events.filter((event) => event.lifecycle === 'planned').length,
    active: data.events.filter((event) => event.lifecycle === 'active').length,
    issued: data.events.reduce((total, event) => total + event.issuedUnits, 0),
  }), [data.events]);

  if (sessionLoading || (profile && loading)) {
    return <div className="space-y-6" aria-busy="true"><SkeletonStats /><SkeletonList rows={5} /></div>;
  }
  if (!profile) return <SignInPrompt module="Events" basename="/events" />;
  if (!canAccessEvents(userRoles)) {
    return (
      <div role="alert" className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <Icon name="lock" className="mx-auto h-8 w-8 text-faint" />
          <h1 className="font-display text-lg font-bold text-ink">No Events access</h1>
          <p className="text-sm text-muted">Ask an administrator for an Events requester, coordinator, viewer, or administrator role.</p>
          <a href="/" className="btn-primary">Back to dashboard</a>
        </div>
      </div>
    );
  }

  const selectedEvent = eventId
    ? data.events.find((event) => event.id === eventId)
    : undefined;

  if (eventId) {
    if (!selectedEvent) {
      return (
        <EmptyState
          icon="calendar"
          title="Event not found"
          message="This event may have been removed or is outside your permitted data scope."
          action={<a href="/events" className="btn-primary">Back to events</a>}
        />
      );
    }
    return (
      <div className="space-y-6">
        <a href="/events" className="btn-ghost w-fit"><Icon name="chevron" className="h-4 w-4 rotate-180" /> Events</a>
        <ModuleHero
          eyebrow="Event lifecycle"
          title={selectedEvent.name}
          description={`${formatDate(selectedEvent.startDate)}${selectedEvent.endDate ? ` to ${formatDate(selectedEvent.endDate)}` : ''}. Event intent is managed here; Warehouse remains accountable for physical stock.`}
          icon="calendar"
          action={<HeroChipButton href={`/warehouse/events/${encodeURIComponent(selectedEvent.id)}`} icon="box">Open Warehouse fulfillment</HeroChipButton>}
          accessory={<Badge tone={LIFECYCLE_TONE[selectedEvent.lifecycle]}>{selectedEvent.lifecycle}</Badge>}
        />
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Reserved" value={selectedEvent.reservedUnits} icon="tag" />
          <StatCard label="Issued" value={selectedEvent.issuedUnits} icon="truck" />
          <StatCard label="Returned" value={selectedEvent.returnedUnits} icon="rotate" />
        </div>
        <Card className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase text-faint">Next operational step</p>
            <h2 className="mt-1 font-display text-lg font-bold text-ink">Complete fulfillment at the source</h2>
            <p className="mt-1 text-sm text-muted">Reserve products, select bins, issue serialized units, and record returns inside Warehouse. The resulting totals flow back into this event.</p>
          </div>
          <a href={`/warehouse/events/${encodeURIComponent(selectedEvent.id)}`} className="btn-primary w-full sm:w-fit">Continue in Warehouse <Icon name="arrowRight" className="h-4 w-4" /></a>
        </Card>
      </div>
    );
  }

  const submit = async () => {
    const validation = validateEventDraft(draft);
    setFormError(validation);
    if (validation) return;
    setSaving(true);
    try {
      await createEvent(draft);
      toast.success(`Created ${draft.name.trim()}`);
      setOpen(false);
      setDraft({ name: '', type: 'corporate', startDate: '' });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'The event could not be created.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Event operations"
        title="Events"
        description="Plan activations, monitor readiness, and hand physical fulfillment to Warehouse without losing the event trail."
        icon="calendar"
        action={canCreateEvents(userRoles) ? (
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            <Icon name="plus" className="h-4 w-4" /> New event
          </button>
        ) : <HeroChipButton href="/knowledge?topic=events" icon="info">Event guide</HeroChipButton>}
      />

      {error && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <p><strong>Some event data is unavailable.</strong> {error}</p>
          <button type="button" className="btn-ghost btn-sm" onClick={() => void refresh()}><Icon name="rotate" className="h-4 w-4" /> Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="All events" value={data.events.length} icon="calendar" />
        <StatCard label="Planned" value={summary.planned} icon="clipboard" />
        <StatCard label="Active" value={summary.active} icon="trend" />
        <StatCard label="Units issued" value={summary.issued} icon="box" />
      </div>

      <section aria-labelledby="event-list-title" className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase text-faint">Lifecycle</p>
          <h2 id="event-list-title" className="font-display text-xl font-bold text-ink">Event readiness and fulfillment</h2>
        </div>
        {data.events.length === 0 ? <EmptyState icon="calendar" title="No events yet" /> : (
          <div className="grid gap-3 xl:grid-cols-2">
            {data.events.map((event) => (
              <Card key={event.id} className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-bold text-ink">{event.name}</h3>
                    <p className="mt-1 text-sm text-muted">{formatDate(event.startDate)}{event.endDate ? ` to ${formatDate(event.endDate)}` : ''}</p>
                  </div>
                  <Badge tone={LIFECYCLE_TONE[event.lifecycle]}>{event.lifecycle}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-2 p-3 text-center">
                  <div><p className="text-lg font-bold text-ink">{event.reservedUnits}</p><p className="text-xs text-muted">Reserved</p></div>
                  <div><p className="text-lg font-bold text-ink">{event.issuedUnits}</p><p className="text-xs text-muted">Issued</p></div>
                  <div><p className="text-lg font-bold text-ink">{event.returnedUnits}</p><p className="text-xs text-muted">Returned</p></div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <a href={`/warehouse/events/${encodeURIComponent(event.id)}`} className="btn-primary flex-1">Open fulfillment <Icon name="arrowRight" className="h-4 w-4" /></a>
                  <a href={`/events/${encodeURIComponent(event.id)}`} className="btn-ghost flex-1">View event</a>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Create event"
        description="Set the operational intent. Products and quantities are requested after creation."
        footer={<button type="button" className="btn-primary w-full" disabled={saving} onClick={() => void submit()}>{saving ? 'Creating...' : 'Create event'}</button>}
      >
        <div className="space-y-4">
          <Field label="Event name" htmlFor="event-name" error={formError ?? undefined}>
            <input id="event-name" className="input" value={draft.name} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))} />
          </Field>
          <Field label="Event type" htmlFor="event-type">
            <select id="event-type" className="input" value={draft.type} onChange={(e) => setDraft((current) => ({ ...current, type: e.target.value }))}>
              {TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="event-start"><input id="event-start" type="date" className="input" value={draft.startDate} onChange={(e) => setDraft((current) => ({ ...current, startDate: e.target.value }))} /></Field>
            <Field label="End date" htmlFor="event-end"><input id="event-end" type="date" className="input" value={draft.endDate ?? ''} onChange={(e) => setDraft((current) => ({ ...current, endDate: e.target.value || undefined }))} /></Field>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
