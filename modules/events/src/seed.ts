import type { EventsData } from './types';

export const EVENTS_DEMO_DATA: EventsData = {
  events: [
    {
      id: 'evt-demo-wellness-caravan',
      name: 'Cebu Wellness Caravan',
      type: 'medical_mission',
      startDate: '2026-07-18',
      endDate: '2026-07-19',
      siteLocationId: 'cebu-event-site',
      lifecycle: 'planned',
      reservedUnits: 160,
      issuedUnits: 0,
      returnedUnits: 0,
    },
    {
      id: 'evt-demo-corporate',
      name: 'Metro Manila Corporate Wellness Day',
      type: 'corporate',
      startDate: '2026-07-14',
      endDate: '2026-07-14',
      siteLocationId: 'pasig-main',
      lifecycle: 'active',
      reservedUnits: 220,
      issuedUnits: 180,
      returnedUnits: 0,
    },
    {
      id: 'evt-demo-lgu',
      name: 'Quezon City Community Activation',
      type: 'government_lgu',
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      siteLocationId: 'qc-event-site',
      lifecycle: 'completed',
      reservedUnits: 300,
      issuedUnits: 280,
      returnedUnits: 18,
    },
  ],
  warnings: [],
};
