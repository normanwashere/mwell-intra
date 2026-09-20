import type { ModuleDefinition } from '../contracts';

export type EventsCapability =
  | 'view_events'
  | 'view_event_custody'
  | 'record_event_outcome'
  | 'create_event'
  | 'manage_events'
  | 'request_fulfillment'
  | 'close_event'
  | 'approve_settlement'
  | 'admin';

export type EventsRole = 'requester' | 'coordinator' | 'viewer' | 'finance_reviewer' | 'seller' | 'admin';

const EVENTS_CAPABILITIES = [
  'view_events',
  'view_event_custody',
  'record_event_outcome',
  'create_event',
  'manage_events',
  'request_fulfillment',
  'close_event',
  'approve_settlement',
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
    seller: {
      label: 'Event Seller',
      description: 'Records own sales and giveaways within explicitly assigned event custody.',
      capabilities: ['view_event_custody', 'record_event_outcome'],
    },
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
    finance_reviewer: {
      label: 'Finance Settlement Reviewer',
      description: 'Reviews submitted event outcomes and independently approves complete settlement evidence.',
      capabilities: ['view_events', 'approve_settlement'],
    },
    admin: {
      label: 'Events Administrator',
      description: 'Full event workspace administration.',
      capabilities: EVENTS_CAPABILITIES.filter((capability) => !['approve_settlement', 'record_event_outcome', 'view_event_custody'].includes(capability)),
    },
  },
};
