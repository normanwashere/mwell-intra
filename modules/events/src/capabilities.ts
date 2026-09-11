import { can, type CapabilityFor, type UserRoles } from '@intra/rbac';

export function eventCapabilityAllowed(
  roles: Partial<UserRoles>, capability: CapabilityFor<'events'>,
  mode: string, liveCapabilities?: readonly string[],
): boolean {
  return mode === 'supabase' ? liveCapabilities?.includes(capability) === true : can(roles, 'events', capability);
}

export function eventRequestHref(id: string, eventId: string): string {
  const query = new URLSearchParams({ tab: 'requests', request: id, next: `/events/${encodeURIComponent(eventId)}` });
  return `/warehouse/fulfillment?${query}`;
}

export const EVENT_LEARNING_TASKS: Record<string, { task: string; label: string }> = {
  create_event: { task: 'create-event', label: 'Create event' },
  request_fulfillment: { task: 'request-event-inventory', label: 'Request event inventory' },
  manage_events: { task: 'reconcile-event-outcomes', label: 'Manage event outcomes' },
  close_event: { task: 'reconcile-event-outcomes', label: 'Close event' },
  approve_settlement: { task: 'review-event-settlement', label: 'Review settlement' },
};
