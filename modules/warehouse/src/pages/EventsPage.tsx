import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import { eventCosting, eventSummary } from '@/domain/events';
import { formatDate } from '@/domain/format';
import type { EventType } from '@/domain/types';
import {
  Badge,
  EmptyState,
  Field,
  PageHeader,
  Sheet,
  StaggerGrid,
  StaggerItem,
  money,
  useToast,
  type Tone,
} from '@/components/ui';
import { Icon } from '@/components/Icon';

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'corporate', label: 'Corporate' },
  { value: 'government_lgu', label: 'Government / LGU' },
  { value: 'medical_mission', label: 'Medical Mission' },
  { value: 'vip_activation', label: 'VIP Activation' },
  { value: 'b2c', label: 'B2C' },
  { value: 'b2b', label: 'B2B' },
];

const TYPE_TONE: Record<string, Tone> = {
  corporate: 'brand',
  government_lgu: 'cyan',
  medical_mission: 'emerald',
  vip_activation: 'amber',
  b2c: 'slate',
  b2b: 'slate',
};

export function EventsPage() {
  const { data, createEvent, can } = useWarehouse();
  const navigate = useNavigate();
  const toast = useToast();
  const canCreate = can('request_fulfillment');

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<EventType>('corporate');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [siteLocationId, setSiteLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;
  const typeLabel = (t: string) =>
    EVENT_TYPES.find((e) => e.value === t)?.label ?? t;
  const eventSites = data.locations.filter((l) => l.type !== 'vendor');

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Event name is required.');
      return;
    }
    if (endDate && startDate && endDate < startDate) {
      setError('End date cannot be before the start date.');
      return;
    }
    const ok = await createEvent({
      name: name.trim(),
      type,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      endDate: endDate || undefined,
      siteLocationId: siteLocationId || undefined,
    });
    if (!ok) return;
    toast.success(`Created ${name.trim()}`);
    setOpen(false);
    setName('');
    setStartDate('');
    setEndDate('');
    setSiteLocationId('');
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Events"
        icon="calendar"
        subtitle="Activations with consumption & costing"
        action={
          canCreate ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => setOpen(true)}>
              <Icon name="plus" className="h-4 w-4" /> New event
            </button>
          ) : undefined
        }
      />

      {data.events.length === 0 ? (
        <EmptyState icon="calendar" title="No events yet" />
      ) : (
        <StaggerGrid className="grid gap-2 lg:grid-cols-2" aria-label="Events">
          {data.events.map((ev) => {
            const summary = eventSummary(data.allocations, data.movements, ev.id);
            const costing = eventCosting(data.movements, data.products, ev.id);
            return (
              <StaggerItem key={ev.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/events/${ev.id}`)}
                  className="card flex w-full items-center justify-between gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-e3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{ev.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone={TYPE_TONE[ev.type]}>{typeLabel(ev.type)}</Badge>
                      <Badge tone="slate">{formatDate(ev.startDate)}</Badge>
                      {summary.reserved > 0 && (
                        <Badge tone="amber">{summary.reserved} reserved</Badge>
                      )}
                      {summary.issued > 0 && (
                        <Badge tone="emerald">{summary.issued} issued</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <div>
                      <p className="tnum text-base font-extrabold text-ink">
                        {money(costing.consumedValue)}
                      </p>
                      {/* "spent" (money) — "consumed" is reserved for units
                          on the event detail (WH-16). */}
                      <p className="text-xs text-faint">spent</p>
                    </div>
                    <Icon name="chevron" className="h-4 w-4 text-faint" />
                  </div>
                </button>
              </StaggerItem>
            );
          })}
        </StaggerGrid>
      )}

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="New event"
        description="Create an activation to allocate stock against."
        footer={
          <button type="button" className="btn-primary w-full" onClick={() => void submit()}>
            Create event
          </button>
        }
      >
        <div className="space-y-3">
          <Field label="Event name" htmlFor="ev-name" error={error ?? undefined}>
            <input
              id="ev-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cebu Wellness Caravan"
            />
          </Field>
          <Field label="Type" htmlFor="ev-type">
            <select
              id="ev-type"
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as EventType)}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" htmlFor="ev-date">
              <input
                id="ev-date"
                type="date"
                className="input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field label="End date" htmlFor="ev-end">
              <input
                id="ev-end"
                type="date"
                className="input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Site location" htmlFor="ev-site">
            <select
              id="ev-site"
              className="input"
              value={siteLocationId}
              onChange={(e) => setSiteLocationId(e.target.value)}
            >
              <option value="">—</option>
              {eventSites.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
