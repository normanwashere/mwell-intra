import type { EventsData } from './types';

export const EVENTS_DEMO_DATA: EventsData = {
  products: [
    { id: 'smart-watch', name: 'mWell Smart Watch', itemClass: 'sku' },
    { id: 'ecg-ring-size-8', name: 'mWell ECG Ring - Size 8', itemClass: 'sku' },
    { id: 'mwell-lanyard', name: 'mWell Branded Lanyard', itemClass: 'merchandise' },
    { id: 'event-shirt', name: 'Event Shirt', itemClass: 'merchandise' },
  ],
  departments: [
    {
      id: 'dept-marketing',
      code: 'MKT',
      name: 'Marketing',
      costCenters: [
        { code: 'MKT-EVENTS', name: 'Events and activations' },
        { code: 'MKT-BRAND', name: 'Brand programs' },
      ],
    },
    {
      id: 'dept-operations',
      code: 'OPS',
      name: 'Operations',
      costCenters: [
        { code: 'OPS-FULFILLMENT', name: 'Fulfillment operations' },
        { code: 'OPS-CS', name: 'Customer service' },
      ],
    },
    {
      id: 'dept-product',
      code: 'PRD',
      name: 'Product',
      costCenters: [{ code: 'PRD-LAUNCH', name: 'Product launches' }],
    },
  ],
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
