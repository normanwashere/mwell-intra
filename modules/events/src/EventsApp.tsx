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
import {
  canAccessEvents,
  canCloseEvents,
  canCreateEvents,
  canManageEvents,
  canRequestEventFulfillment,
} from './access';
import {
  useEventsData,
  validateEventDraftFields,
  validateEventFulfillmentFields,
  validateEventManagementFields,
} from './data';
import type { EventDraft, EventLifecycle, EventManagementAction } from './types';

const TYPE_OPTIONS = [
  ['corporate', 'Corporate'],
  ['government_lgu', 'Government / LGU'],
  ['medical_mission', 'Medical mission'],
  ['vip_activation', 'VIP activation'],
  ['b2c', 'B2C'],
  ['b2b', 'B2B'],
] as const;

const LIFECYCLE_TONE: Record<EventLifecycle, 'brand' | 'emerald' | 'slate' | 'rose'> = {
  planned: 'brand',
  active: 'emerald',
  completed: 'slate',
  closed: 'slate',
  cancelled: 'rose',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`));
}

function focusFirstInvalidField(
  errors: Record<string, string>,
  fields: ReadonlyArray<[string, string]>,
) {
  const target = fields.find(([key]) => Boolean(errors[key]))?.[1];
  if (target) window.setTimeout(() => document.getElementById(target)?.focus());
}

export function EventsApp({
  eventId,
  openCreate = false,
}: {
  eventId?: string;
  openCreate?: boolean;
}) {
  const { profile, userRoles, loading: sessionLoading } = useSession();
  const {
    data,
    loading,
    error,
    refresh,
    createEvent,
    manageEvent,
    requestFulfillment,
  } = useEventsData();
  const toast = useToast();
  const [open, setOpen] = useState(openCreate);
  const [draft, setDraft] = useState<EventDraft>({ name: '', type: 'corporate', startDate: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageAction, setManageAction] = useState<EventManagementAction>('edit');
  const [manageReason, setManageReason] = useState('');
  const [manageErrors, setManageErrors] = useState<Record<string, string>>({});
  const [manageDraft, setManageDraft] = useState<EventDraft>({ name: '', type: 'corporate', startDate: '' });
  const [ownerEmail, setOwnerEmail] = useState('');
  const [fulfillmentOpen, setFulfillmentOpen] = useState(false);
  const [fulfillmentErrors, setFulfillmentErrors] = useState<Record<string, string>>({});
  const [fulfillment, setFulfillment] = useState({
    department: 'marketing', purpose: '', costCenter: '', requiredDate: '',
    treatment: 'expense' as 'expense' | 'custody' | 'sale', productId: '', quantity: 1,
  });

  const summary = useMemo(() => ({
    planned: data.events.filter((event) => event.lifecycle === 'planned').length,
    active: data.events.filter((event) => event.lifecycle === 'active').length,
    issued: data.events.reduce((total, event) => total + event.issuedUnits, 0),
  }), [data.events]);
  const today = new Date().toISOString().slice(0, 10);

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
  const mayManage = canManageEvents(userRoles);
  const mayClose = canCloseEvents(userRoles);
  const mayRequest = canRequestEventFulfillment(userRoles);

  const openManagement = (action: EventManagementAction) => {
    if (!selectedEvent) return;
    setManageAction(action);
    setManageReason('');
    setManageErrors({});
    setOwnerEmail(selectedEvent.ownerEmail ?? '');
    setManageDraft({
      name: selectedEvent.name,
      type: selectedEvent.type,
      startDate: selectedEvent.startDate,
      endDate: selectedEvent.endDate,
      siteLocationId: selectedEvent.siteLocationId,
    });
    setManageOpen(true);
  };

  const submitManagement = async () => {
    if (!selectedEvent) return;
    const validation = validateEventManagementFields(
      manageAction,
      manageDraft,
      manageReason,
      ownerEmail,
      today,
    );
    setManageErrors(validation);
    if (Object.keys(validation).length > 0) {
      focusFirstInvalidField(validation, [
        ['name', 'manage-event-name'],
        ['startDate', 'manage-event-start'],
        ['endDate', 'manage-event-end'],
        ['ownerEmail', 'manage-event-owner'],
        ['reason', 'manage-event-reason'],
      ]);
      return;
    }
    setSaving(true);
    try {
      const changes = manageAction === 'transfer_owner'
        ? { ownerEmail }
        : manageAction === 'reschedule'
          ? { startDate: manageDraft.startDate, endDate: manageDraft.endDate }
          : manageAction === 'edit'
            ? manageDraft
            : undefined;
      await manageEvent({
        eventId: selectedEvent.id,
        action: manageAction,
        reason: manageReason,
        expectedUpdatedAt: selectedEvent.updatedAt,
        changes,
      });
      toast.success('Event history updated.');
      setManageOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The event could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  const submitFulfillment = async () => {
    if (!selectedEvent) return;
    const request = {
      eventId: selectedEvent.id,
      requestingDepartment: fulfillment.department,
      purpose: fulfillment.purpose,
      costCenter: fulfillment.costCenter,
      requiredDate: fulfillment.requiredDate,
      expenseTreatment: fulfillment.treatment,
      productId: fulfillment.productId,
      quantity: fulfillment.quantity,
      idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `event-request-${Date.now()}`,
    };
    const selectedProduct = data.products?.find((product) => product.id === fulfillment.productId);
    const validation = validateEventFulfillmentFields(request, {
      minimumDate: today,
      maximumDate: selectedEvent.endDate,
      itemClass: selectedProduct?.itemClass,
    });
    setFulfillmentErrors(validation);
    if (Object.keys(validation).length > 0) {
      focusFirstInvalidField(validation, [
        ['department', 'event-request-department'],
        ['purpose', 'event-request-purpose'],
        ['costCenter', 'event-request-cost'],
        ['requiredDate', 'event-request-date'],
        ['productId', 'event-request-product'],
        ['quantity', 'event-request-quantity'],
        ['treatment', 'event-request-treatment'],
      ]);
      return;
    }
    setSaving(true);
    try {
      await requestFulfillment(request);
      toast.success('Warehouse stock request sent for approval.');
      setFulfillmentOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The stock request could not be sent.');
    } finally {
      setSaving(false);
    }
  };

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
          action={mayRequest && ['planned', 'active'].includes(selectedEvent.lifecycle) ? (
            <button type="button" className="btn-primary" onClick={() => {
              setFulfillmentErrors({});
              setFulfillment((current) => ({
                ...current,
                productId: current.productId || data.products?.[0]?.id || '',
                requiredDate: current.requiredDate || (selectedEvent.startDate >= today ? selectedEvent.startDate : today),
              }));
              setFulfillmentOpen(true);
            }}>
              <Icon name="box" className="h-4 w-4" /> Request warehouse stock
            </button>
          ) : undefined}
          accessory={<Badge tone={LIFECYCLE_TONE[selectedEvent.lifecycle]}>{selectedEvent.lifecycle}</Badge>}
        />
        <div className="grid grid-cols-1 gap-3 min-[340px]:grid-cols-3">
          <StatCard label="Reserved" value={selectedEvent.reservedUnits} icon="tag" />
          <StatCard label="Issued" value={selectedEvent.issuedUnits} icon="truck" />
          <StatCard label="Returned" value={selectedEvent.returnedUnits} icon="rotate" />
        </div>
        <Card className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase text-faint">Next operational step</p>
            <h2 className="mt-1 font-display text-lg font-bold text-ink">Govern the event, then hand off demand</h2>
            <p className="mt-1 text-sm text-muted">Event owners request the products and required date here. Warehouse remains responsible for allocation, picking, issue, and returns.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {mayManage && <button type="button" className="btn-outline" onClick={() => openManagement('edit')}>Edit details</button>}
            {mayManage && <button type="button" className="btn-outline" onClick={() => openManagement('reschedule')}>Reschedule</button>}
            {mayManage && <button type="button" className="btn-outline" onClick={() => openManagement('transfer_owner')}>Transfer owner</button>}
            {mayClose && !['closed', 'cancelled'].includes(selectedEvent.lifecycle) && (
              <>
                <button type="button" className="btn-outline" onClick={() => openManagement('close')}>Close event</button>
                <button type="button" className="btn-ghost text-rose-700 dark:text-rose-300" onClick={() => openManagement('cancel')}>Cancel event</button>
              </>
            )}
            {mayClose && ['closed', 'cancelled'].includes(selectedEvent.lifecycle) && (
              <button type="button" className="btn-primary" onClick={() => openManagement('reopen')}>Reopen event</button>
            )}
          </div>
        </Card>

        <Sheet
          open={manageOpen}
          onOpenChange={(nextOpen) => {
            setManageOpen(nextOpen);
            if (!nextOpen) setManageErrors({});
          }}
          title={{ edit: 'Edit event', reschedule: 'Reschedule event', transfer_owner: 'Transfer owner', close: 'Close event', cancel: 'Cancel event', reopen: 'Reopen event' }[manageAction]}
          description="Every lifecycle change requires a reason and is written to the event audit history."
          footer={<button type="button" className="btn-primary w-full" disabled={saving} onClick={() => void submitManagement()}>{saving ? 'Saving...' : 'Confirm change'}</button>}
        >
          <div className="space-y-4">
            {manageAction === 'edit' && (
              <>
                <Field label="Event name" htmlFor="manage-event-name" error={manageErrors.name}><input id="manage-event-name" className="input" aria-invalid={Boolean(manageErrors.name)} value={manageDraft.name} onChange={(event) => { setManageDraft((current) => ({ ...current, name: event.target.value })); setManageErrors((current) => ({ ...current, name: '' })); }} /></Field>
                <Field label="Event type" htmlFor="manage-event-type"><select id="manage-event-type" className="input" value={manageDraft.type} onChange={(event) => setManageDraft((current) => ({ ...current, type: event.target.value }))}>{TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                <Field label="Venue or site" htmlFor="manage-event-site"><input id="manage-event-site" className="input" value={manageDraft.siteLocationId ?? ''} onChange={(event) => setManageDraft((current) => ({ ...current, siteLocationId: event.target.value || undefined }))} /></Field>
              </>
            )}
            {manageAction === 'reschedule' && <div className="grid gap-4 sm:grid-cols-2"><Field label="Start date" htmlFor="manage-event-start" error={manageErrors.startDate}><input id="manage-event-start" type="date" min={today} className="input" aria-invalid={Boolean(manageErrors.startDate)} value={manageDraft.startDate} onChange={(event) => { setManageDraft((current) => ({ ...current, startDate: event.target.value })); setManageErrors((current) => ({ ...current, startDate: '', endDate: '' })); }} /></Field><Field label="End date" htmlFor="manage-event-end" error={manageErrors.endDate}><input id="manage-event-end" type="date" min={manageDraft.startDate || today} className="input" aria-invalid={Boolean(manageErrors.endDate)} value={manageDraft.endDate ?? ''} onChange={(event) => { setManageDraft((current) => ({ ...current, endDate: event.target.value || undefined })); setManageErrors((current) => ({ ...current, endDate: '' })); }} /></Field></div>}
            {manageAction === 'transfer_owner' && <Field label="New owner email" htmlFor="manage-event-owner" error={manageErrors.ownerEmail}><input id="manage-event-owner" type="email" className="input" aria-invalid={Boolean(manageErrors.ownerEmail)} value={ownerEmail} onChange={(event) => { setOwnerEmail(event.target.value); setManageErrors((current) => ({ ...current, ownerEmail: '' })); }} /></Field>}
            <Field label="Reason" htmlFor="manage-event-reason" error={manageErrors.reason}><textarea id="manage-event-reason" className="input min-h-24" aria-invalid={Boolean(manageErrors.reason)} value={manageReason} onChange={(event) => { setManageReason(event.target.value); setManageErrors((current) => ({ ...current, reason: '' })); }} required /></Field>
          </div>
        </Sheet>

        <Sheet
          open={fulfillmentOpen}
          onOpenChange={(nextOpen) => {
            setFulfillmentOpen(nextOpen);
            if (!nextOpen) setFulfillmentErrors({});
          }}
          title="Request warehouse stock"
          description="The event reference stays attached through approval and Warehouse fulfillment."
          footer={<button type="button" className="btn-primary w-full" disabled={saving} onClick={() => void submitFulfillment()}>{saving ? 'Submitting...' : 'Submit for approval'}</button>}
        >
          <div className="space-y-4">
            <Field label="Department" htmlFor="event-request-department" error={fulfillmentErrors.department}><input id="event-request-department" className="input" aria-invalid={Boolean(fulfillmentErrors.department)} value={fulfillment.department} onChange={(event) => { setFulfillment((current) => ({ ...current, department: event.target.value })); setFulfillmentErrors((current) => ({ ...current, department: '' })); }} required /></Field>
            <Field label="Business purpose" htmlFor="event-request-purpose" error={fulfillmentErrors.purpose}><textarea id="event-request-purpose" className="input min-h-24" aria-invalid={Boolean(fulfillmentErrors.purpose)} value={fulfillment.purpose} onChange={(event) => { setFulfillment((current) => ({ ...current, purpose: event.target.value })); setFulfillmentErrors((current) => ({ ...current, purpose: '' })); }} required /></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Cost center" htmlFor="event-request-cost" error={fulfillmentErrors.costCenter}><input id="event-request-cost" className="input" aria-invalid={Boolean(fulfillmentErrors.costCenter)} value={fulfillment.costCenter} onChange={(event) => { setFulfillment((current) => ({ ...current, costCenter: event.target.value })); setFulfillmentErrors((current) => ({ ...current, costCenter: '' })); }} required /></Field><Field label="Required date" htmlFor="event-request-date" error={fulfillmentErrors.requiredDate}><input id="event-request-date" type="date" min={today} max={selectedEvent.endDate} className="input" aria-invalid={Boolean(fulfillmentErrors.requiredDate)} value={fulfillment.requiredDate} onChange={(event) => { setFulfillment((current) => ({ ...current, requiredDate: event.target.value })); setFulfillmentErrors((current) => ({ ...current, requiredDate: '' })); }} required /></Field></div>
            <Field label="Product" htmlFor="event-request-product" error={fulfillmentErrors.productId}><select id="event-request-product" className="input" aria-invalid={Boolean(fulfillmentErrors.productId)} value={fulfillment.productId} onChange={(event) => { setFulfillment((current) => ({ ...current, productId: event.target.value })); setFulfillmentErrors((current) => ({ ...current, productId: '', treatment: '' })); }}><option value="">Select a product</option>{(data.products ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Quantity" htmlFor="event-request-quantity" error={fulfillmentErrors.quantity}><input id="event-request-quantity" type="number" min="1" step="1" className="input" aria-invalid={Boolean(fulfillmentErrors.quantity)} value={fulfillment.quantity} onChange={(event) => { setFulfillment((current) => ({ ...current, quantity: Number(event.target.value) })); setFulfillmentErrors((current) => ({ ...current, quantity: '' })); }} /></Field><Field label="Cost treatment" htmlFor="event-request-treatment" error={fulfillmentErrors.treatment}><select id="event-request-treatment" className="input" aria-invalid={Boolean(fulfillmentErrors.treatment)} value={fulfillment.treatment} onChange={(event) => { setFulfillment((current) => ({ ...current, treatment: event.target.value as typeof current.treatment })); setFulfillmentErrors((current) => ({ ...current, treatment: '' })); }}><option value="expense">Expense</option><option value="custody">Custody</option><option value="sale">Sale</option></select></Field></div>
          </div>
        </Sheet>
      </div>
    );
  }

  const submit = async () => {
    const validation = validateEventDraftFields(draft);
    setFormErrors(validation);
    const firstField = validation.name ? 'event-name' : validation.startDate ? 'event-start' : validation.endDate ? 'event-end' : undefined;
    if (firstField) {
      window.setTimeout(() => document.getElementById(firstField)?.focus());
      return;
    }
    setSaving(true);
    try {
      await createEvent(draft);
      toast.success(`Created ${draft.name.trim()}`);
      setOpen(false);
      setDraft({ name: '', type: 'corporate', startDate: '' });
    } catch (cause) {
      setFormErrors({ form: cause instanceof Error ? cause.message : 'The event could not be created.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Event operations"
        title="Event planning and fulfillment"
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
                  <a href={`/events/${encodeURIComponent(event.id)}`} className="btn-primary flex-1">View event <Icon name="arrowRight" className="h-4 w-4" /></a>
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
          {formErrors.form && <p role="alert" className="text-sm font-semibold text-rose-600">{formErrors.form}</p>}
          <Field label="Event name" htmlFor="event-name" error={formErrors.name}>
            <input id="event-name" className="input" aria-invalid={Boolean(formErrors.name)} value={draft.name} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))} />
          </Field>
          <Field label="Event type" htmlFor="event-type">
            <select id="event-type" className="input" value={draft.type} onChange={(e) => setDraft((current) => ({ ...current, type: e.target.value }))}>
              {TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="event-start" error={formErrors.startDate}><input id="event-start" type="date" className="input" aria-invalid={Boolean(formErrors.startDate)} required value={draft.startDate} onChange={(e) => setDraft((current) => ({ ...current, startDate: e.target.value }))} /></Field>
            <Field label="End date" htmlFor="event-end" error={formErrors.endDate}><input id="event-end" type="date" className="input" aria-invalid={Boolean(formErrors.endDate)} value={draft.endDate ?? ''} onChange={(e) => setDraft((current) => ({ ...current, endDate: e.target.value || undefined }))} /></Field>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
