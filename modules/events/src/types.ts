export type EventLifecycle =
  "planned" | "active" | "completed" | "cancelled" | "closed";

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
  "edit" | "reschedule" | "cancel" | "close" | "reopen" | "transfer_owner";

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
  expenseTreatment: "expense" | "custody" | "sale";
  productId: string;
  quantity: number;
  idempotencyKey: string;
}

export type EventReconciliationStatus = "draft" | "submitted" | "approved";

export interface EventReconciliation {
  eventId: string;
  status: EventReconciliationStatus;
  soldUnits: number;
  giveawayUnits: number;
  returnedUnits: number;
  lostUnits: number;
  damagedUnits: number;
  rekitUnits: number;
  grossSalesAmount: number;
  financeReference?: string;
  evidenceUrl?: string;
  note?: string;
  preparedBy?: string;
  approvedAt?: string;
  updatedAt: string;
}

export interface SaveEventReconciliationInput extends Omit<
  EventReconciliation,
  "status" | "preparedBy" | "approvedAt" | "updatedAt"
> {
  action: "save" | "submit" | "approve";
  expectedUpdatedAt?: string;
}
export interface EventsData {
  events: EventRecord[];
  products?: Array<{ id: string; name: string; itemClass: string }>;
  departments?: Array<{
    id: string;
    code: string;
    name: string;
    costCenters: Array<{ code: string; name: string }>;
  }>;
  reconciliations?: EventReconciliation[];
  fulfillmentHandoffs?: Array<{
    id: string;
    eventId: string;
    status: "demo_recorded" | "submitted";
    createdAt: string;
  }>;
  warnings: string[];
}
