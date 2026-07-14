export type EventLifecycle = 'planned' | 'active' | 'completed';

export interface EventRecord {
  id: string;
  name: string;
  type: string;
  startDate: string;
  endDate?: string;
  siteLocationId?: string;
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

export interface EventsData {
  events: EventRecord[];
  warnings: string[];
}
