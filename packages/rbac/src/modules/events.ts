import type { ModuleDefinition } from '../contracts';

export type EventsCapability =
  | 'view_events'
  | 'create_event'
  | 'manage_events'
  | 'request_fulfillment'
  | 'close_event'
  | 'admin';

export type EventsRole = 'requester' | 'coordinator' | 'viewer' | 'admin';

const EVENTS_CAPABILITIES = [
  'view_events',
  'create_event',
  'manage_events',
  'request_fulfillment',
  'close_event',
  'admin',
] as const satisfies readonly EventsCapability[];

export const eventsModule: ModuleDefinition<
  'events',
  EventsRole,
  EventsCapability
> = {
  module: 'events',
  label: 'Events',
  capabilities: EVENTS_CAPABILITIES,
  roles: {
    requester: {
      label: 'Event Requester',
      description: 'Creates events and requests warehouse fulfillment.',
      capabilities: ['view_events', 'create_event', 'request_fulfillment'],
    },
    coordinator: {
      label: 'Event Coordinator',
      description: 'Coordinates the event lifecycle from planning through closure.',
      capabilities: [
        'view_events',
        'create_event',
        'manage_events',
        'request_fulfillment',
        'close_event',
      ],
    },
    viewer: {
      label: 'Event Viewer',
      description: 'Reviews event plans and fulfillment status.',
      capabilities: ['view_events'],
    },
    admin: {
      label: 'Events Administrator',
      description: 'Full event workspace administration.',
      capabilities: [...EVENTS_CAPABILITIES],
    },
  },
};
