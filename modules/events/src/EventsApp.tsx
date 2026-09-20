"use client";

import { userFacingError } from '@intra/ui';
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@intra/auth";
import {
  Badge,
  Card,
  EmptyState,
  EvidenceAttachment,
  useEvidenceAttachment,
  Field,
  Icon,
  PageHeader,
  Sheet,
  SignInPrompt,
  SkeletonList,
  SkeletonStats,
  useToast,
} from "@intra/ui";
import { EVENT_LEARNING_TASKS, eventCapabilityAllowed, eventRequestHref } from './capabilities';
import { EventWorkflowSummary } from './EventWorkflowSummary';
import { EventCustodyWorkspace } from './EventCustodyWorkspace';
import {
  eventReconciliationHandoff,
  quoteEventDemand,
  useEventsData,
  validateEventDraftFields,
  validateEventFulfillmentFields,
  validateEventManagementFields,
  validateEventReconciliationTransition,
} from "./data";
import type {
  EventDraft,
  EventLifecycle,
  EventManagementAction,
} from "./types";

const TYPE_OPTIONS = [
  ["corporate", "Corporate"],
  ["government_lgu", "Government / LGU"],
  ["medical_mission", "Medical mission"],
  ["vip_activation", "VIP activation"],
  ["b2c", "B2C"],
  ["b2b", "B2B"],
] as const;

const LIFECYCLE_TONE: Record<
  EventLifecycle,
  "brand" | "emerald" | "slate" | "rose"
> = {
  planned: "brand",
  active: "emerald",
  completed: "slate",
  closed: "slate",
  cancelled: "rose",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function focusFirstInvalidField(
  errors: Record<string, string>,
  fields: ReadonlyArray<[string, string]>,
) {
  const target = fields.find(([key]) => Boolean(errors[key]))?.[1];
  if (target) window.setTimeout(() => document.getElementById(target)?.focus());
}

function EventsManagementApp({
  eventId,
  openCreate = false,
}: {
  eventId?: string;
  openCreate?: boolean;
}) {
  const { profile, userRoles, mode, supabaseClient, userCapabilities, roleCapabilities, loading: sessionLoading } = useSession();
  const allowed = (cap: Parameters<typeof eventCapabilityAllowed>[1]) => eventCapabilityAllowed(userRoles, cap, mode, userCapabilities?.events);
  const {
    data,
    loading,
    error,
    refresh,
    createEvent,
    manageEvent,
    requestFulfillment,
    saveReconciliation,
    openReconciliationEvidence,
    isDemo,
  } = useEventsData();
  const toast = useToast();
  const [open, setOpen] = useState(openCreate);
  const [draft, setDraft] = useState<EventDraft>({
    name: "",
    type: "corporate",
    startDate: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastHandoff, setLastHandoff] = useState<{ id: string; eventId: string } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageAction, setManageAction] =
    useState<EventManagementAction>("edit");
  const [manageReason, setManageReason] = useState("");
  const [manageErrors, setManageErrors] = useState<Record<string, string>>({});
  const [manageDraft, setManageDraft] = useState<EventDraft>({
    name: "",
    type: "corporate",
    startDate: "",
  });
  const [ownerEmail, setOwnerEmail] = useState("");
  const [fulfillmentOpen, setFulfillmentOpen] = useState(false);
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const [openingEvidence, setOpeningEvidence] = useState(false);
  const [evidenceLink, setEvidenceLink] = useState('');
  useEffect(() => {
    if (!evidenceLink) return;
    const timer = window.setTimeout(() => setEvidenceLink(''), 295_000);
    return () => window.clearTimeout(timer);
  }, [evidenceLink]);
  const evidenceOperation = useRef<object | null>(null);
  const reconciliationSaving = useRef(false);
  useEffect(() => {
    setReconciliationOpen(false);
    setLastHandoff(null);
    setOpeningEvidence(false);
    setEvidenceLink('');
    evidenceOperation.current = null;
    return () => { evidenceOperation.current = null; };
  }, [eventId, profile?.id]);
  const [reconciliationErrors, setReconciliationErrors] = useState<
    Record<string, string>
  >({});
  const [reconciliationAction, setReconciliationAction] = useState<
    "save" | "submit" | "approve"
  >("save");
  const [reconciliationDraft, setReconciliationDraft] = useState({
    soldUnits: 0,
    giveawayUnits: 0,
    returnedUnits: 0,
    lostUnits: 0,
    damagedUnits: 0,
    rekitUnits: 0,
    grossSalesAmount: 0,
    financeReference: "",
    evidenceUrl: "",
    note: "",
  });
  const [fulfillmentErrors, setFulfillmentErrors] = useState<
    Record<string, string>
  >({});
  const fulfillmentIntent = useRef<{ fingerprint: string; key: string } | null>(null);
  const fulfillmentSaving = useRef(false);
  const reconciliationAccounted = reconciliationDraft.soldUnits + reconciliationDraft.giveawayUnits + reconciliationDraft.returnedUnits + reconciliationDraft.lostUnits + reconciliationDraft.damagedUnits + reconciliationDraft.rekitUnits;
  const [fulfillment, setFulfillment] = useState({
    department: "marketing",
    purpose: "",
    costCenter: "",
    requiredDate: "",
    treatment: "expense" as "expense" | "custody" | "sale",
    lines: [{ productId: '', quantity: 1 }],
  });
  const [availability, setAvailability] = useState<Record<string, number> | null>(null);
  const requestedProducts = JSON.stringify(fulfillment.lines.map(line => line.productId).filter(Boolean));
  useEffect(() => {
    setAvailability(null);
    if (!fulfillmentOpen || !eventId || !supabaseClient || mode !== 'supabase') return;
    let cancelled = false;
    void quoteEventDemand(supabaseClient, eventId, JSON.parse(requestedProducts) as string[])
      .then(result => { if (!cancelled) setAvailability(result); })
      .catch(() => { if (!cancelled) setAvailability(null); });
    return () => { cancelled = true; };
  }, [eventId, profile?.id, fulfillmentOpen, requestedProducts, supabaseClient, mode]);

  const summary = useMemo(
    () => ({
      planned: data.events.filter((event) => event.lifecycle === "planned")
        .length,
      active: data.events.filter((event) => event.lifecycle === "active")
        .length,
      issued: data.events.reduce(
        (total, event) => total + event.issuedUnits,
        0,
      ),
    }),
    [data.events],
  );
  const today = new Date().toISOString().slice(0, 10);
  const selectedDepartment = data.departments?.find(
    (department) => department.code === fulfillment.department,
  );
  const reconciliationAttachment = useEvidenceAttachment(
    `${profile?.id ?? 'signed-out'}:${eventId}:${reconciliationOpen}:${reconciliationAction}`,
    reconciliationOpen ? reconciliationDraft.evidenceUrl : '',
  );

  if (sessionLoading || (profile && loading)) {
    return (
      <div className="space-y-6" aria-busy="true">
        <SkeletonStats />
        <SkeletonList rows={5} />
      </div>
    );
  }
  if (!profile) return <SignInPrompt module="Events" basename="/events" />;
  if (!allowed('view_events')) {
    return (
      <div
        role="alert"
        className="grid min-h-[60vh] place-items-center p-6 text-center"
      >
        <div className="max-w-sm space-y-3">
          <Icon name="lock" className="mx-auto h-8 w-8 text-faint" />
          <h1 className="font-display text-lg font-bold text-ink">
            No Events access
          </h1>
          <p className="text-sm text-muted">
            Ask an administrator for an Events requester, coordinator, viewer,
            or administrator role.
          </p>
          <a href="/" className="btn-primary">
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  const selectedEvent = eventId
    ? data.events.find((event) => event.id === eventId)
    : undefined;
  const mayManage = allowed('manage_events') && !error;
  const mayClose = allowed('close_event') && !error;
  const mayRequest = allowed('request_fulfillment') && !error;
  const mayApproveReconciliation = allowed('approve_settlement') && !error;
  const lockedActions = ['create_event', 'manage_events', 'close_event', 'request_fulfillment', 'approve_settlement'].filter(cap => mode === 'supabase' && roleCapabilities?.events?.includes(cap) && !userCapabilities?.events?.includes(cap));
  const recovery = lockedActions.length > 0 && <div role="status" className="space-y-2 border-l-4 border-amber-500 p-3 text-sm">
    <p>Assigned actions unavailable. Complete required learning or refresh your access with your administrator.</p>
    <ul>{lockedActions.map(cap => <li key={cap}><a className="inline-flex min-h-11 items-center underline" href={`/onboarding?task=${EVENT_LEARNING_TASKS[cap]!.task}&next=${encodeURIComponent(eventId ? `/events/${encodeURIComponent(eventId)}` : '/events')}`}>Resume {EVENT_LEARNING_TASKS[cap]!.label} learning</a></li>)}</ul>
    <a className="inline-flex min-h-11 items-center underline" href={`/onboarding?next=${encodeURIComponent(eventId ? `/events/${encodeURIComponent(eventId)}` : '/events')}`}>Review Events prerequisites</a>
  </div>;
  const readFailure = error && <div role="alert" className="space-y-2 border-l-4 border-amber-500 p-3 text-sm">
    <p><strong>Event data unavailable.</strong> {userFacingError(error)} {selectedEvent ? 'Displayed data may be stale. Actions are paused until refresh succeeds.' : 'The event could not be checked.'}</p>
    <button type="button" className="btn-ghost min-h-11" onClick={() => void refresh()}>Retry</button>
  </div>;
  const reconciliation = data.reconciliations?.find(
    (record) => record.eventId === selectedEvent?.id,
  );
  const reconciliationHandoff =
    reconciliation && selectedEvent
      ? eventReconciliationHandoff(
          reconciliation,
          selectedEvent.issuedUnits,
          { mayManage, mayApprove: mayApproveReconciliation },
        )
      : undefined;

  const openManagement = (action: EventManagementAction) => {
    if (!selectedEvent || !(action === 'edit' || action === 'reschedule' || action === 'transfer_owner' ? mayManage : mayClose)) return;
    setManageAction(action);
    setManageReason("");
    setManageErrors({});
    setOwnerEmail(selectedEvent.ownerEmail ?? "");
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
    if (!selectedEvent || saving || !(manageAction === 'edit' || manageAction === 'reschedule' || manageAction === 'transfer_owner' ? mayManage : mayClose)) return;
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
        ["name", "manage-event-name"],
        ["startDate", "manage-event-start"],
        ["endDate", "manage-event-end"],
        ["ownerEmail", "manage-event-owner"],
        ["reason", "manage-event-reason"],
      ]);
      return;
    }
    setSaving(true);
    try {
      const changes =
        manageAction === "transfer_owner"
          ? { ownerEmail }
          : manageAction === "reschedule"
            ? { startDate: manageDraft.startDate, endDate: manageDraft.endDate }
            : manageAction === "edit"
              ? manageDraft
              : undefined;
      await manageEvent({
        eventId: selectedEvent.id,
        action: manageAction,
        reason: manageReason,
        expectedUpdatedAt: selectedEvent.updatedAt,
        changes,
      });
      toast.success("Event history updated.");
      setManageOpen(false);
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The event could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  };

  const submitFulfillment = async () => {
    if (!selectedEvent || !mayRequest || saving || fulfillmentSaving.current) return;
    const fingerprint = JSON.stringify({ eventId: selectedEvent.id, ...fulfillment });
    if (fulfillmentIntent.current?.fingerprint !== fingerprint) {
      fulfillmentIntent.current = { fingerprint, key: globalThis.crypto.randomUUID() };
    }
    const request = {
      eventId: selectedEvent.id,
      requestingDepartment: fulfillment.department,
      purpose: fulfillment.purpose,
      costCenter: fulfillment.costCenter,
      requiredDate: fulfillment.requiredDate,
      expenseTreatment: fulfillment.treatment,
      lines: fulfillment.lines,
      idempotencyKey: fulfillmentIntent.current.key,
    };
    const validation = validateEventFulfillmentFields(request, {
      minimumDate: today,
      maximumDate: selectedEvent.endDate,
      products: data.products,
    });
    setFulfillmentErrors(validation);
    if (Object.keys(validation).length > 0) {
      focusFirstInvalidField(validation, [
        ["department", "event-request-department"],
        ["purpose", "event-request-purpose"],
        ["costCenter", "event-request-cost"],
        ["requiredDate", "event-request-date"],
        ...fulfillment.lines.flatMap((_, index): [string, string][] => [
          [`lines.${index}.productId`, `event-request-product-${index}`],
          [`lines.${index}.quantity`, `event-request-quantity-${index}`],
        ]),
        ["treatment", "event-request-treatment"],
      ]);
      return;
    }
    setSaving(true);
    fulfillmentSaving.current = true;
    try {
      const handoff = await requestFulfillment(request);
      if (handoff?.id) setLastHandoff(handoff);
      toast.success(
        isDemo
          ? "Demo Warehouse handoff recorded locally. It has not been sent to Warehouse."
          : "Warehouse stock request sent for approval.",
      );
      setFulfillmentOpen(false);
      fulfillmentIntent.current = null;
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The stock request could not be sent.",
      );
    } finally {
      fulfillmentSaving.current = false;
      setSaving(false);
    }
  };

  const openReconciliation = (action: "save" | "submit" | "approve") => {
    setReconciliationAction(action);
    setReconciliationErrors({});
    setReconciliationDraft({
      soldUnits: reconciliation?.soldUnits ?? 0,
      giveawayUnits: reconciliation?.giveawayUnits ?? 0,
      returnedUnits: reconciliation?.returnedUnits ?? 0,
      lostUnits: reconciliation?.lostUnits ?? 0,
      damagedUnits: reconciliation?.damagedUnits ?? 0,
      rekitUnits: reconciliation?.rekitUnits ?? 0,
      grossSalesAmount: reconciliation?.grossSalesAmount ?? 0,
      financeReference: reconciliation?.financeReference ?? "",
      evidenceUrl: reconciliation?.evidenceUrl ?? "",
      note: reconciliation?.note ?? "",
    });
    setReconciliationOpen(true);
  };

  const submitReconciliation = async () => {
    if (reconciliationAction === 'approve' ? !mayApproveReconciliation : !mayManage) return;
    if (error || loading) {
      setReconciliationErrors({ outcomes: "Refresh the event custody data before saving or submitting outcomes." });
      return;
    }
    if (!selectedEvent || saving || reconciliationSaving.current || !reconciliationAttachment.canSubmit(reconciliationAction !== 'save')) return;
    const validation = validateEventReconciliationTransition(
      { action: reconciliationAction, ...reconciliationDraft, evidenceUrl: reconciliationAttachment.reference },
      selectedEvent.issuedUnits,
    );
    setReconciliationErrors(validation);
    if (Object.keys(validation).length > 0) {
      focusFirstInvalidField(validation, [
        ["outcomes", "reconciliation-soldUnits"],
        ["evidenceUrl", "reconciliation-evidence"],
        ["financeReference", "reconciliation-finance"],
      ]);
      return;
    }
    reconciliationSaving.current = true;
    setSaving(true);
    try {
      await saveReconciliation({
        eventId: selectedEvent.id,
        action: reconciliationAction,
        expectedUpdatedAt: reconciliation?.updatedAt,
        ...reconciliationDraft,
        evidenceUrl: reconciliationAttachment.reference,
      });
      toast.success(
        reconciliationAction === "approve"
          ? "Event settlement approved."
          : reconciliationAction === "submit"
            ? isDemo
              ? "Demo Event settlement recorded locally. It has not been sent to Finance."
              : "Event reconciliation sent to Finance."
            : "Event reconciliation saved.",
      );
      setReconciliationOpen(false);
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Event reconciliation could not be saved.",
      );
    } finally {
      reconciliationSaving.current = false;
      setSaving(false);
    }
  };
  const openEvidence = async () => {
    if (!selectedEvent || !reconciliation?.evidenceUrl) return;
    const operation = {};
    evidenceOperation.current = operation;
    setEvidenceLink('');
    setOpeningEvidence(true);
    try {
      const evidenceUrl = await openReconciliationEvidence(selectedEvent.id);
      const parsed = new URL(evidenceUrl);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid evidence preview.');
      if (evidenceOperation.current === operation) {
        setEvidenceLink(evidenceUrl);
        window.open(evidenceUrl, "_blank", "noopener,noreferrer");
      }
    } catch (cause) {
      if (evidenceOperation.current !== operation) return;
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Event reconciliation evidence could not be opened.",
      );
    } finally {
      if (evidenceOperation.current === operation) setOpeningEvidence(false);
    }
  };
  if (eventId) {
    if (!selectedEvent && error) return <div className="space-y-4">{readFailure}<a href="/events" className="btn-ghost">Back to events</a></div>;
    if (!selectedEvent) {
      return (
        <EmptyState
          icon="calendar"
          title="Event not found"
          headingLevel={1}
          message="This event may have been removed or is outside your permitted data scope."
          action={
            <a href="/events" className="btn-primary">
              Back to events
            </a>
          }
        />
      );
    }
    return (
      <div className="space-y-6">
        {readFailure}
        {recovery}
        <a href="/events" className="btn-ghost w-fit">
          <Icon name="chevron" className="h-4 w-4 rotate-180" /> Events
        </a>
        <PageHeader
          eyebrow="Event lifecycle"
          title={selectedEvent.name}
          subtitle={`${formatDate(selectedEvent.startDate)}${selectedEvent.endDate ? ` to ${formatDate(selectedEvent.endDate)}` : ""}`}
          action={
            mayRequest &&
            ["planned", "active"].includes(selectedEvent.lifecycle) ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setFulfillmentErrors({});
                  const defaultDepartment =
                    data.departments?.find(
                      (department) =>
                        department.code === fulfillment.department,
                    ) ?? data.departments?.[0];
                  const defaultCostCenter =
                    defaultDepartment?.costCenters.find(
                      (costCenter) =>
                        costCenter.code === fulfillment.costCenter,
                    ) ?? defaultDepartment?.costCenters[0];
                  setFulfillment((current) => ({
                    ...current,
                    department: defaultDepartment?.code ?? "",
                    costCenter: defaultCostCenter?.code ?? "",
                    lines: current.lines.map((line, index) => index === 0 && !line.productId
                      ? { ...line, productId: data.products?.[0]?.id ?? '' } : line),
                    requiredDate:
                      current.requiredDate ||
                      (selectedEvent.startDate >= today
                        ? selectedEvent.startDate
                        : today),
                  }));
                  setFulfillmentOpen(true);
                }}
              >
                <Icon name="box" className="h-4 w-4" /> Request warehouse stock
              </button>
            ) : undefined
          }
          status={
            <Badge tone={LIFECYCLE_TONE[selectedEvent.lifecycle]}>
              {selectedEvent.lifecycle}
            </Badge>
          }
        />
        <EventWorkflowSummary event={selectedEvent} reconciliation={reconciliation} handoff={reconciliationHandoff} readFailed={Boolean(error)} />
        <Card className="overflow-hidden p-0">
          <dl
            aria-label="Event custody totals"
            className="grid gap-1"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 5rem), 1fr))" }}
          >
            {(
              [
                ["Reserved", selectedEvent.reservedUnits, "tag"],
                ["Issued", selectedEvent.issuedUnits, "truck"],
                ["Returned", selectedEvent.returnedUnits, "rotate"],
              ] as const
            ).map(([label, value, icon]) => (
              <div key={label} className="min-w-0 px-3 py-3 sm:px-5 sm:py-4">
                <dt className="flex min-w-0 flex-col items-start gap-2 text-xs font-semibold text-muted sm:flex-row sm:flex-wrap sm:items-center">
                  <Icon
                    name={icon}
                    className="h-4 w-4 shrink-0 text-brand-600"
                  />
                  <span className="max-w-full [overflow-wrap:anywhere]">{label}</span>
                </dt>
                <dd className="tnum mt-2 break-all font-display text-lg font-extrabold leading-tight text-ink sm:text-2xl">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        {(data.fulfillmentHandoffs?.some(item => item.eventId === eventId) || lastHandoff?.eventId === eventId) && <section aria-label="Warehouse handoffs" className="space-y-2 border-y border-line py-3">
          <h2 className="text-base font-semibold">Warehouse handoffs</h2>
          {[...(lastHandoff?.eventId === eventId ? [lastHandoff] : []), ...(data.fulfillmentHandoffs ?? []).filter(item => item.eventId === eventId && item.id !== lastHandoff?.id)].map(item => <p key={item.id} className="break-all text-sm">Next responsibility: Warehouse. <a className="inline-flex min-h-11 items-center underline" href={eventRequestHref(item.id, eventId)}>Open stock request {item.id}</a></p>)}
        </section>}
        <Card className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-faint">
                Outcome control
              </p>
              <h2 className="mt-1 font-display text-lg font-bold text-ink [overflow-wrap:anywhere]">
                Event reconciliation
              </h2>
              <p className="mt-1 text-sm text-muted">
                Sales, giveaways, returns, losses, damage, and re-kitting must
                account for every issued unit before closure.
              </p>
            </div>
            <Badge
              tone={
                reconciliation?.status === "approved"
                  ? "emerald"
                  : reconciliation?.status === "submitted"
                    ? "brand"
                    : "slate"
              }
            >
              {reconciliation?.status ?? "not started"}
            </Badge>
          </div>
          {reconciliation && (
            <>
              <div
                aria-label="Event outcome totals"
                className="grid gap-2"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, max(7rem, calc((100% - 1rem) / 3))), 1fr))" }}
              >
                {[
                  ["Sold", reconciliation.soldUnits],
                  ["Giveaway", reconciliation.giveawayUnits],
                  ["Returned", reconciliation.returnedUnits],
                  [
                    "Lost / damaged",
                    reconciliation.lostUnits + reconciliation.damagedUnits,
                  ],
                  ["Re-kitted", reconciliation.rekitUnits],
                  ["Sales PHP", reconciliation.grossSalesAmount],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="min-w-0 rounded-lg bg-surface-2 p-3 [overflow-wrap:anywhere]"
                  >
                    <p className="text-xs text-muted">{label}</p>
                    <p className="font-display text-lg font-bold text-ink">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              {reconciliationHandoff && (
                <div className="space-y-3 border-t border-line pt-4">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-semibold text-faint">Required evidence</dt>
                      <dd className="mt-1 text-ink">
                        {reconciliation.evidenceUrl ? "Evidence attached" : "Evidence missing"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-faint">Finance reference</dt>
                      <dd className="mt-1 text-ink">
                        {reconciliation.financeReference ?? "Pending Finance review"}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {reconciliation?.evidenceUrl && (
              <button
                type="button"
                className="btn-outline"
                disabled={openingEvidence}
                onClick={() => void openEvidence()}
              >
                <Icon name="clipboard" className="h-4 w-4" />
                {openingEvidence ? "Opening..." : "Open evidence"}
              </button>
            )}
            {evidenceLink && <a href={evidenceLink} target="_blank" rel="noopener noreferrer" className="btn-outline">
              <Icon name="download" className="h-4 w-4" /> Open document
            </a>}
            {mayManage && reconciliation?.status !== "approved" && (
              <>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => openReconciliation("save")}
                >
                  {reconciliation ? "Edit outcomes" : "Start reconciliation"}
                </button>
                {reconciliation?.status !== "submitted" && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => openReconciliation("submit")}
                  >
                    Submit to Finance
                  </button>
                )}
              </>
            )}
            {mayApproveReconciliation &&
              reconciliation?.status === "submitted" && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => openReconciliation("approve")}
                >
                  Review settlement
                </button>
              )}
          </div>
        </Card>
        <Card className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase text-faint">
              Next operational step
            </p>
            <h2 className="mt-1 font-display text-lg font-bold text-ink">
              Govern the event, then hand off demand
            </h2>
            <p className="mt-1 text-sm text-muted">
              Event owners request the products and required date here.
              Warehouse remains responsible for allocation, picking, issue, and
              returns.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {mayManage && (
              <button
                type="button"
                className="btn-outline"
                onClick={() => openManagement("edit")}
              >
                Edit details
              </button>
            )}
            {mayManage && (
              <button
                type="button"
                className="btn-outline"
                onClick={() => openManagement("reschedule")}
              >
                Reschedule
              </button>
            )}
            {mayManage && (
              <button
                type="button"
                className="btn-outline"
                onClick={() => openManagement("transfer_owner")}
              >
                Transfer owner
              </button>
            )}
            {mayClose &&
              !["closed", "cancelled"].includes(selectedEvent.lifecycle) && (
                <>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => openManagement("close")}
                  >
                    Close event
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-rose-700 dark:text-rose-300"
                    onClick={() => openManagement("cancel")}
                  >
                    Cancel event
                  </button>
                </>
              )}
            {mayClose &&
              ["closed", "cancelled"].includes(selectedEvent.lifecycle) && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => openManagement("reopen")}
                >
                  Reopen event
                </button>
              )}
          </div>
        </Card>

        {mode === 'supabase' && (mayManage || mayApproveReconciliation) && <EventCustodyWorkspace key={`${profile.id}:${selectedEvent.id}`} eventId={selectedEvent.id} embedded />}
        <Sheet
          open={reconciliationOpen && (reconciliationAction === 'approve' ? mayApproveReconciliation : mayManage)}
          onOpenChange={setReconciliationOpen}
          title={
            reconciliationAction === "approve"
              ? "Approve event settlement"
              : "Reconcile event outcomes"
          }
          description="Every issued unit must end as sold, given away, returned, lost, damaged, or re-kitted."
          footer={
            <button
              type="button"
              className="btn-primary w-full"
              disabled={saving || !reconciliationAttachment.canSubmit(reconciliationAction !== 'save')}
              onClick={() => void submitReconciliation()}
            >
              {saving
                ? "Saving..."
                : reconciliationAction === "approve"
                  ? "Approve settlement"
                  : reconciliationAction === "submit"
                    ? "Submit reconciliation"
                    : "Save draft"}
            </button>
          }
        >
          <div className="space-y-4">
            <div className="sticky top-0 z-10 border-b border-line bg-surface py-3" role="status" aria-live="polite">
              <p className="font-semibold break-words">{selectedEvent?.name}</p>
              <p>Issued: {selectedEvent?.issuedUnits ?? 0} / Accounted: {reconciliationAccounted} / Remaining: {(selectedEvent?.issuedUnits ?? 0) - reconciliationAccounted}</p>
              <p className="text-sm text-muted">{reconciliationAccounted > (selectedEvent?.issuedUnits ?? 0) ? 'Excess outcomes' : reconciliationAccounted < (selectedEvent?.issuedUnits ?? 0) ? 'Incomplete draft balance' : 'Balanced'}</p>
            </div>
            {reconciliationErrors.outcomes && (
              <p
                role="alert"
                className="text-sm font-semibold text-rose-600 dark:text-rose-300"
              >
                {reconciliationErrors.outcomes}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["soldUnits", "Sold"],
                  ["giveawayUnits", "Giveaway"],
                  ["returnedUnits", "Returned"],
                  ["lostUnits", "Lost"],
                  ["damagedUnits", "Damaged"],
                  ["rekitUnits", "Re-kitted"],
                ] as const
              ).map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  htmlFor={"reconciliation-" + key}
                >
                  <input
                    id={"reconciliation-" + key}
                    className="input"
                    type="number"
                    min="0"
                    value={reconciliationDraft[key]}
                    disabled={reconciliationAction === "approve"}
                    onChange={(event) => {
                      setReconciliationDraft((current) => ({
                        ...current,
                        [key]: Number(event.target.value),
                      }));
                      setReconciliationErrors((current) => ({
                        ...current,
                        outcomes: "",
                      }));
                    }}
                  />
                </Field>
              ))}
            </div>
            <Field label="Gross sales (PHP)" htmlFor="reconciliation-sales">
              <input
                id="reconciliation-sales"
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={reconciliationDraft.grossSalesAmount}
                disabled={reconciliationAction === "approve"}
                onChange={(event) =>
                  setReconciliationDraft((current) => ({
                    ...current,
                    grossSalesAmount: Number(event.target.value),
                  }))
                }
              />
            </Field>
            <Field
              label="Finance reference"
              htmlFor="reconciliation-finance"
              hint={
                reconciliationAction === "approve"
                  ? "Required from the independent Finance review."
                  : "Assigned by Finance during review."
              }
              error={reconciliationErrors.financeReference}
            >
              <input
                id="reconciliation-finance"
                className="input"
                value={reconciliationDraft.financeReference}
                disabled={reconciliationAction !== "approve"}
                aria-invalid={Boolean(reconciliationErrors.financeReference)}
                onChange={(event) => {
                  setReconciliationDraft((current) => ({
                    ...current,
                    financeReference: event.target.value,
                  }));
                  setReconciliationErrors((current) => ({
                    ...current,
                    financeReference: "",
                  }));
                }}
                required={reconciliationAction === "approve"}
              />
            </Field>
            <EvidenceAttachment id="reconciliation-evidence" attachment={reconciliationAttachment}
              recordLabel={selectedEvent.name} disabled={saving || reconciliationAction === 'approve'}
              uploadScope={reconciliationAction !== 'approve' ? { sourceType: 'event_reconciliation', sourceId: selectedEvent.id } : undefined} />
            <Field label="Reconciliation note" htmlFor="reconciliation-note">
              <textarea
                id="reconciliation-note"
                className="input min-h-24"
                value={reconciliationDraft.note}
                disabled={reconciliationAction === "approve"}
                onChange={(event) =>
                  setReconciliationDraft((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
        </Sheet>
        <Sheet
          open={manageOpen && (manageAction === 'edit' || manageAction === 'reschedule' || manageAction === 'transfer_owner' ? mayManage : mayClose)}
          onOpenChange={(nextOpen) => {
            setManageOpen(nextOpen);
            if (!nextOpen) setManageErrors({});
          }}
          title={
            {
              edit: "Edit event",
              reschedule: "Reschedule event",
              transfer_owner: "Transfer owner",
              close: "Close event",
              cancel: "Cancel event",
              reopen: "Reopen event",
            }[manageAction]
          }
          description="Every lifecycle change requires a reason and is written to the event audit history."
          footer={
            <button
              type="button"
              className="btn-primary w-full"
              disabled={saving}
              onClick={() => void submitManagement()}
            >
              {saving ? "Saving..." : "Confirm change"}
            </button>
          }
        >
          <div className="space-y-4">
            {manageAction === "edit" && (
              <>
                <Field
                  label="Event name"
                  htmlFor="manage-event-name"
                  error={manageErrors.name}
                >
                  <input
                    id="manage-event-name"
                    className="input"
                    aria-invalid={Boolean(manageErrors.name)}
                    value={manageDraft.name}
                    onChange={(event) => {
                      setManageDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }));
                      setManageErrors((current) => ({ ...current, name: "" }));
                    }}
                  />
                </Field>
                <Field label="Event type" htmlFor="manage-event-type">
                  <select
                    id="manage-event-type"
                    className="input"
                    value={manageDraft.type}
                    onChange={(event) =>
                      setManageDraft((current) => ({
                        ...current,
                        type: event.target.value,
                      }))
                    }
                  >
                    {TYPE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Venue or site" htmlFor="manage-event-site">
                  <input
                    id="manage-event-site"
                    className="input"
                    value={manageDraft.siteLocationId ?? ""}
                    onChange={(event) =>
                      setManageDraft((current) => ({
                        ...current,
                        siteLocationId: event.target.value || undefined,
                      }))
                    }
                  />
                </Field>
              </>
            )}
            {manageAction === "reschedule" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Start date"
                  htmlFor="manage-event-start"
                  error={manageErrors.startDate}
                >
                  <input
                    id="manage-event-start"
                    type="date"
                    min={today}
                    className="input"
                    aria-invalid={Boolean(manageErrors.startDate)}
                    value={manageDraft.startDate}
                    onChange={(event) => {
                      setManageDraft((current) => ({
                        ...current,
                        startDate: event.target.value,
                      }));
                      setManageErrors((current) => ({
                        ...current,
                        startDate: "",
                        endDate: "",
                      }));
                    }}
                  />
                </Field>
                <Field
                  label="End date"
                  htmlFor="manage-event-end"
                  error={manageErrors.endDate}
                >
                  <input
                    id="manage-event-end"
                    type="date"
                    min={manageDraft.startDate || today}
                    className="input"
                    aria-invalid={Boolean(manageErrors.endDate)}
                    value={manageDraft.endDate ?? ""}
                    onChange={(event) => {
                      setManageDraft((current) => ({
                        ...current,
                        endDate: event.target.value || undefined,
                      }));
                      setManageErrors((current) => ({
                        ...current,
                        endDate: "",
                      }));
                    }}
                  />
                </Field>
              </div>
            )}
            {manageAction === "transfer_owner" && (
              <Field
                label="New owner email"
                htmlFor="manage-event-owner"
                error={manageErrors.ownerEmail}
              >
                <input
                  id="manage-event-owner"
                  type="email"
                  className="input"
                  aria-invalid={Boolean(manageErrors.ownerEmail)}
                  value={ownerEmail}
                  onChange={(event) => {
                    setOwnerEmail(event.target.value);
                    setManageErrors((current) => ({
                      ...current,
                      ownerEmail: "",
                    }));
                  }}
                />
              </Field>
            )}
            <Field
              label="Reason"
              htmlFor="manage-event-reason"
              error={manageErrors.reason}
            >
              <textarea
                id="manage-event-reason"
                className="input min-h-24"
                aria-invalid={Boolean(manageErrors.reason)}
                value={manageReason}
                onChange={(event) => {
                  setManageReason(event.target.value);
                  setManageErrors((current) => ({ ...current, reason: "" }));
                }}
                required
              />
            </Field>
          </div>
        </Sheet>

        <Sheet
          open={fulfillmentOpen && mayRequest}
          onOpenChange={(nextOpen) => {
            setFulfillmentOpen(nextOpen);
            if (!nextOpen) setFulfillmentErrors({});
          }}
          title="Request warehouse stock"
          description="The event reference stays attached through approval and Warehouse fulfillment."
          footer={
            <button
              type="button"
              className="btn-primary w-full"
              disabled={saving}
              onClick={() => void submitFulfillment()}
            >
              {saving ? "Submitting..." : "Submit for approval"}
            </button>
          }
        >
          <div className="space-y-4">
            <Field
              label="Department"
              htmlFor="event-request-department"
              error={fulfillmentErrors.department}
            >
              <select
                id="event-request-department"
                className="input"
                aria-invalid={Boolean(fulfillmentErrors.department)}
                value={fulfillment.department}
                onChange={(event) => {
                  setFulfillment((current) => ({
                    ...current,
                    department: event.target.value,
                    costCenter:
                      data.departments?.find(
                        (department) => department.code === event.target.value,
                      )?.costCenters[0]?.code ?? "",
                  }));
                  setFulfillmentErrors((current) => ({
                    ...current,
                    department: "",
                  }));
                }}
                required
              >
                <option value="">Select a department</option>
                {(data.departments ?? []).map((department) => (
                  <option key={department.id} value={department.code}>
                    {department.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Business purpose"
              htmlFor="event-request-purpose"
              error={fulfillmentErrors.purpose}
            >
              <textarea
                id="event-request-purpose"
                className="input min-h-24"
                aria-invalid={Boolean(fulfillmentErrors.purpose)}
                value={fulfillment.purpose}
                onChange={(event) => {
                  setFulfillment((current) => ({
                    ...current,
                    purpose: event.target.value,
                  }));
                  setFulfillmentErrors((current) => ({
                    ...current,
                    purpose: "",
                  }));
                }}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Cost center"
                htmlFor="event-request-cost"
                error={fulfillmentErrors.costCenter}
              >
                <select
                  id="event-request-cost"
                  className="input"
                  aria-invalid={Boolean(fulfillmentErrors.costCenter)}
                  value={fulfillment.costCenter}
                  onChange={(event) => {
                    setFulfillment((current) => ({
                      ...current,
                      costCenter: event.target.value,
                    }));
                    setFulfillmentErrors((current) => ({
                      ...current,
                      costCenter: "",
                    }));
                  }}
                  required
                  disabled={!selectedDepartment}
                >
                  <option value="">Select a cost center</option>
                  {(selectedDepartment?.costCenters ?? []).map((costCenter) => (
                    <option key={costCenter.code} value={costCenter.code}>
                      {costCenter.code} - {costCenter.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Required date"
                htmlFor="event-request-date"
                error={fulfillmentErrors.requiredDate}
              >
                <input
                  id="event-request-date"
                  type="date"
                  min={today}
                  max={selectedEvent.endDate}
                  className="input"
                  aria-invalid={Boolean(fulfillmentErrors.requiredDate)}
                  value={fulfillment.requiredDate}
                  onChange={(event) => {
                    setFulfillment((current) => ({
                      ...current,
                      requiredDate: event.target.value,
                    }));
                    setFulfillmentErrors((current) => ({
                      ...current,
                      requiredDate: "",
                    }));
                  }}
                  required
                />
              </Field>
            </div>
            <fieldset disabled={saving} className="min-w-0 space-y-4">
              <legend className="text-sm font-semibold">Stock lines</legend>
              {fulfillmentErrors.lines && <p role="alert" className="text-sm text-rose-700">{fulfillmentErrors.lines}</p>}
              {fulfillment.lines.map((line, index) => <div key={index} className="min-w-0 space-y-2 border-b border-line pb-3">
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.75rem] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_2.75rem]">
                  <div className="col-span-2 min-w-0 sm:col-span-1">
                  <Field label={`Product ${index + 1}`} htmlFor={`event-request-product-${index}`} error={fulfillmentErrors[`lines.${index}.productId`]}>
                    <select id={`event-request-product-${index}`} className="input min-w-0" value={line.productId}
                      aria-invalid={Boolean(fulfillmentErrors[`lines.${index}.productId`])}
                      onChange={event => {
                        setFulfillment(current => ({ ...current, lines: current.lines.map((row, i) => i === index ? { ...row, productId: event.target.value } : row) }));
                        setFulfillmentErrors({});
                      }}>
                      <option value="">Select a product</option>
                      {(data.products ?? []).map(product => <option key={product.id} value={product.id}
                        disabled={fulfillment.lines.some((other, i) => i !== index && other.productId === product.id)}>{product.name}</option>)}
                    </select>
                  </Field>
                  </div>
                  <Field label={`Quantity ${index + 1}`} htmlFor={`event-request-quantity-${index}`} error={fulfillmentErrors[`lines.${index}.quantity`]}>
                    <input id={`event-request-quantity-${index}`} type="number" min="1" max="2147483647" step="1" className="input" value={line.quantity}
                      aria-invalid={Boolean(fulfillmentErrors[`lines.${index}.quantity`])}
                      onChange={event => {
                        setFulfillment(current => ({ ...current, lines: current.lines.map((row, i) => i === index ? { ...row, quantity: Number(event.target.value) } : row) }));
                        setFulfillmentErrors({});
                      }} />
                  </Field>
                  <button type="button" className="btn-ghost h-11 w-11 p-0" title={`Remove product ${index + 1}`} aria-label={`Remove product ${index + 1}`}
                    disabled={fulfillment.lines.length === 1} onClick={() => {
                      setFulfillment(current => ({ ...current, lines: current.lines.filter((_, i) => i !== index) })); setFulfillmentErrors({});
                    }}><Icon name="x" className="h-4 w-4" /></button>
                </div>
                <p className="text-xs text-muted">Requested: {line.quantity || 0}; eligible: {availability?.[line.productId] ?? 'unconfirmed'}; shortage: {availability?.[line.productId] == null ? 'unconfirmed' : Math.max(0, line.quantity - availability[line.productId]!)}; {fulfillment.treatment}; next: Approval reviewer</p>
              </div>)}
              <button type="button" className="btn-outline" disabled={fulfillment.lines.length >= 100}
                onClick={() => setFulfillment(current => ({ ...current, lines: [...current.lines, { productId: '', quantity: 1 }] }))}>
                <Icon name="plus" className="h-4 w-4" /> Add product
              </button>
            </fieldset>
            <div>
              <Field
                label="Cost treatment"
                htmlFor="event-request-treatment"
                error={fulfillmentErrors.treatment}
              >
                <select
                  id="event-request-treatment"
                  className="input"
                  aria-invalid={Boolean(fulfillmentErrors.treatment)}
                  value={fulfillment.treatment}
                  onChange={(event) => {
                    setFulfillment((current) => ({
                      ...current,
                      treatment: event.target.value as typeof current.treatment,
                    }));
                    setFulfillmentErrors((current) => ({
                      ...current,
                      treatment: "",
                    }));
                  }}
                >
                  <option value="expense">Expense</option>
                  <option value="custody">Custody</option>
                  <option value="sale">Sale</option>
                </select>
              </Field>
            </div>
          </div>
        </Sheet>
      </div>
    );
  }

  const submit = async () => {
    if (!allowed('create_event') || error || saving) return;
    const validation = validateEventDraftFields(draft);
    setFormErrors(validation);
    const firstField = validation.name
      ? "event-name"
      : validation.startDate
        ? "event-start"
        : validation.endDate
          ? "event-end"
          : undefined;
    if (firstField) {
      window.setTimeout(() => document.getElementById(firstField)?.focus());
      return;
    }
    setSaving(true);
    try {
      await createEvent(draft);
      toast.success(`Created ${draft.name.trim()}`);
      setOpen(false);
      setDraft({ name: "", type: "corporate", startDate: "" });
    } catch (cause) {
      setFormErrors({
        form:
          cause instanceof Error
            ? cause.message
            : "The event could not be created.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {recovery}
      <PageHeader title="Events" icon="calendar" action={
        <div className="flex flex-wrap items-center gap-2">
          {allowed('create_event') && !error ? (
            <button
              type="button"
              className="btn-outline inline-flex min-h-11 items-center gap-2"
              onClick={() => setOpen(true)}
            >
              <Icon name="plus" className="h-4 w-4" /> New event
            </button>
          ) : (
            <a href="/knowledge?article=feature-events-workspace" className="btn-ghost min-h-11">
              <Icon name="info" className="h-4 w-4" />
              Event guide
            </a>
          )}
        </div>
      } />

      {error && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
        >
          <p>
            <strong>Some event data is unavailable.</strong> {userFacingError(error)}
          </p>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => void refresh()}
          >
            <Icon name="rotate" className="h-4 w-4" /> Retry
          </button>
        </div>
      )}

      <section aria-label="Event totals" className="border-y border-line py-3">
        <dl className="grid grid-cols-4 gap-2 sm:gap-4">
          {[
            ['All events', data.events.length],
            ['Planned', summary.planned],
            ['Active', summary.active],
            ['Units issued', summary.issued],
          ].map(([label, value]) => <div key={label} className="min-w-0">
            <dt className="min-h-8 break-words text-xs text-muted sm:min-h-0">{label}</dt>
            <dd className="mt-1 break-all text-xl font-bold tabular-nums text-ink">{value}</dd>
          </div>)}
        </dl>
      </section>

      <section aria-labelledby="event-list-title" className="space-y-3">
        <h2 id="event-list-title" className="sr-only">Event readiness and fulfillment</h2>
        {data.events.length === 0 && !error ? (
          <EmptyState icon="calendar" title="No events yet" />
        ) : (
          <div className="grid gap-3">
            {data.events.map((event) => (
              <Card key={event.id} className="grid min-w-0 items-center gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words font-display text-base font-bold text-ink">
                      {event.name}
                    </h3>
                    <p className="mt-1 text-sm text-muted">
                      {formatDate(event.startDate)}
                      {event.endDate ? ` to ${formatDate(event.endDate)}` : ""}
                    </p>
                  </div>
                  <Badge tone={LIFECYCLE_TONE[event.lifecycle]}>
                    {event.lifecycle}
                  </Badge>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-3 border-y border-line py-3 text-center lg:border-y-0 lg:border-l lg:pl-4">
                  <div>
                    <p className="text-lg font-bold text-ink">
                      {event.reservedUnits}
                    </p>
                    <p className="text-xs text-muted">Reserved</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-ink">
                      {event.issuedUnits}
                    </p>
                    <p className="text-xs text-muted">Issued</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-ink">
                      {event.returnedUnits}
                    </p>
                    <p className="text-xs text-muted">Returned</p>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                  <a
                    href={`/events/${encodeURIComponent(event.id)}`}
                    className="btn-outline flex-1"
                  >
                    View event <Icon name="arrowRight" className="h-4 w-4" />
                  </a>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Sheet
        open={open && allowed('create_event') && !error}
        onOpenChange={setOpen}
        title="Create event"
        description="Set the operational intent. Products and quantities are requested after creation."
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? "Creating..." : "Create event"}
          </button>
        }
      >
        <div className="space-y-4">
          {formErrors.form && (
            <p role="alert" className="text-sm font-semibold text-rose-600">
              {formErrors.form}
            </p>
          )}
          <Field
            label="Event name"
            htmlFor="event-name"
            error={formErrors.name}
          >
            <input
              id="event-name"
              className="input"
              aria-invalid={Boolean(formErrors.name)}
              value={draft.name}
              onChange={(e) =>
                setDraft((current) => ({ ...current, name: e.target.value }))
              }
            />
          </Field>
          <Field label="Event type" htmlFor="event-type">
            <select
              id="event-type"
              className="input"
              value={draft.type}
              onChange={(e) =>
                setDraft((current) => ({ ...current, type: e.target.value }))
              }
            >
              {TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Start date"
              htmlFor="event-start"
              error={formErrors.startDate}
            >
              <input
                id="event-start"
                type="date"
                className="input"
                aria-invalid={Boolean(formErrors.startDate)}
                required
                value={draft.startDate}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    startDate: e.target.value,
                  }))
                }
              />
            </Field>
            <Field
              label="End date"
              htmlFor="event-end"
              error={formErrors.endDate}
            >
              <input
                id="event-end"
                type="date"
                className="input"
                aria-invalid={Boolean(formErrors.endDate)}
                value={draft.endDate ?? ""}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    endDate: e.target.value || undefined,
                  }))
                }
              />
            </Field>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

export function EventsApp(props: { eventId?: string; openCreate?: boolean }) {
  const session = useSession();
  const scopedSeller = eventCapabilityAllowed(session.userRoles, 'view_event_custody', session.mode, session.userCapabilities?.events)
    && !eventCapabilityAllowed(session.userRoles, 'view_events', session.mode, session.userCapabilities?.events);
  return scopedSeller ? <EventCustodyWorkspace key={`${session.profile?.id}:${props.eventId}`} eventId={props.eventId} /> : <EventsManagementApp {...props} />;
}
