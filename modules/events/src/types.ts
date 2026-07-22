export type EventLifecycle = 'planned' | 'active' | 'completed' | 'cancelled' | 'closed';

export interface EventRecord {
  id: string;
  name: string;
  type: string;
  startDate: string;
  endDate?: string;
  siteLocationId?: string;
  ownerEmail?: string;
  updatedAt?: string;
  lifecycle: EventLifecycle;
  reservedUnits: number;
  issuedUnits: number;
  returnedUnits: number;
}

export interface EventDraft {
  name: string;
  type: string;
  startDate: string;
  endDate?: string;
  siteLocationId?: string;
}

export type EventManagementAction =
  | 'edit'
  | 'reschedule'
  | 'cancel'
  | 'close'
  | 'reopen'
  | 'transfer_owner';

export interface EventManagementInput {
  eventId: string;
  action: EventManagementAction;
  reason: string;
  expectedUpdatedAt?: string;
  changes?: Partial<EventDraft> & { ownerEmail?: string };
}

export interface EventFulfillmentRequest {
  eventId: string;
  requestingDepartment: string;
  purpose: string;
  costCenter: string;
  requiredDate: string;
  expenseTreatment: 'expense' | 'custody' | 'sale';
  productId: string;
  quantity: number;
  idempotencyKey: string;
}

export interface EventsData {
  events: EventRecord[];
  products?: Array<{ id: string; name: string; itemClass: string }>;
  warnings: string[];
}
