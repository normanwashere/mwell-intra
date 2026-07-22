// Demo profiles for memory/fallback mode (spec §5, LLD §10). These drive the
// scoped `can()` gate locally so `next build` + `next dev` work with NO live
// Supabase backend. Roles use the canonical @intra/rbac role names; every
// internal profile carries `core:['staff']` as its baseline read grant.
//
// NEVER used for the live contract — memory mode never establishes a real
// session (matching by email only).

import type { MemoryProfile } from '@intra/auth';

export const DEMO_PROFILES: readonly MemoryProfile[] = [
  {
    id: 'demo-logistics',
    email: 'logistics@mwell.demo',
    kind: 'employee',
    name: 'Bea Santos',
    title: 'Logistics Supervisor',
    roles: {
      core: ['staff'],
      // + warehouse procurement so /warehouse/procurement, /warehouse/suppliers
      // and PO authoring are walkable in demo (UX review WH-2). In memory mode
      // the module's account menu lets Bea switch between the two roles.
      warehouse: ['logistics_supervisor', 'procurement'],
    },
  },
  {
    id: 'demo-operations',
    email: 'ops@mwell.demo',
    kind: 'employee',
    name: 'Marco Reyes',
    title: 'eCommerce / Operations',
    roles: {
      core: ['staff'],
      warehouse: ['operations'],
    },
  },
  {
    id: 'demo-procurement',
    email: 'procurement@mwell.demo',
    kind: 'employee',
    name: 'Liza Cruz',
    title: 'Procurement Officer',
    roles: {
      core: ['staff'],
      procurement: ['procurement_officer'],
    },
  },
  {
    id: 'demo-procurement-approver',
    email: 'approver@mwell.demo',
    kind: 'employee',
    name: 'Marta Ramos',
    title: 'Department Head — Procurement Approver',
    roles: {
      // Acts as the Department Head / BU SPOC tier on the procurement
      // approval ladder (mWell Procurement Policy §3).
      core: ['staff'],
      procurement: ['approver'],
    },
  },
  {
    id: 'demo-procurement-finance',
    email: 'finance.procurement@mwell.demo',
    kind: 'employee',
    name: 'Elena Torres',
    title: 'Finance — Procurement Reviewer',
    roles: {
      // Dedicated Finance seat on the procurement ladder. High-value or
      // capex / construction / manpower categories loop this profile in
      // before the final approver (policy §3, §12).
      core: ['staff'],
      procurement: ['finance'],
    },
  },
  {
    id: 'demo-procurement-cfo',
    email: 'cfo@mwell.demo',
    kind: 'employee',
    name: 'Diego Ang',
    title: 'CFO / DOA Approver',
    roles: {
      // Sits at the Final Approver tier — signs off per the current DOA
      // (mWell Procurement Policy §9). Also holds procurement admin so the
      // demo can walk the last step of the ladder from a single seat.
      core: ['staff'],
      procurement: ['admin'],
    },
  },
  {
    id: 'demo-legal',
    email: 'legal@mwell.demo',
    kind: 'employee',
    name: 'Andre Villanueva',
    title: 'Legal Reviewer',
    roles: {
      core: ['staff'],
      legal: ['legal_reviewer'],
    },
  },
  {
    id: 'demo-finance',
    email: 'finance@mwell.demo',
    kind: 'employee',
    name: 'Rina Domingo',
    title: 'Finance Manager',
    roles: {
      core: ['staff'],
      warehouse: ['finance'],
      procurement: ['finance'],
    },
  },
  {
    id: 'demo-bi',
    email: 'bi@mwell.demo',
    kind: 'employee',
    name: 'Jules Aquino',
    title: 'BI Analyst',
    roles: {
      core: ['staff'],
      warehouse: ['bi_analyst'],
      insights: ['analyst'],
    },
  },
  {
    id: 'demo-marketing',
    email: 'marketing@mwell.demo',
    kind: 'employee',
    name: 'Kai Mendoza',
    title: 'Marketing Lead',
    roles: {
      core: ['staff'],
      warehouse: ['marketing'],
      events: ['coordinator'],
    },
  },
  {
    id: 'demo-business-unit',
    email: 'business.unit@mwell.demo',
    kind: 'employee',
    name: 'Nina Flores',
    title: 'Business Unit Requester',
    roles: {
      core: ['staff'],
      warehouse: ['business_unit'],
      events: ['requester'],
    },
  },
  {
    id: 'demo-event-viewer',
    email: 'events.viewer@mwell.demo',
    kind: 'employee',
    name: 'Sam Bautista',
    title: 'Event Viewer',
    roles: { core: ['staff'], events: ['viewer'] },
  },
  {
    id: 'demo-insights-manager',
    email: 'insights.manager@mwell.demo',
    kind: 'employee',
    name: 'Maya Tan',
    title: 'Department Manager',
    roles: { core: ['staff'], insights: ['manager'] },
  },
  {
    id: 'demo-executive',
    email: 'executive@mwell.demo',
    kind: 'employee',
    name: 'Rafael Ong',
    title: 'Executive',
    roles: { core: ['staff'], insights: ['executive'] },
  },
  {
    id: 'demo-product-owner',
    email: 'product.owner@mwell.demo',
    kind: 'employee',
    name: 'Pia Salcedo',
    title: 'Product Owner',
    roles: {
      core: ['staff'],
      product: ['product_owner'],
    },
  },
  {
    id: 'demo-warehouse-admin',
    email: 'warehouse.admin@mwell.demo',
    kind: 'employee',
    name: 'Alex Rivera',
    title: 'Warehouse Administrator',
    roles: {
      core: ['staff'],
      warehouse: ['warehouse_admin'],
      events: ['admin'],
      insights: ['admin'],
    },
  },
  {
    id: 'demo-admin',
    email: 'admin@mwell.demo',
    kind: 'employee',
    name: 'Patricia Lim',
    title: 'Platform Administrator',
    roles: {
      // Platform admins manage users + shared master data; they do NOT
      // silently hold every module role. To act inside a module they must be
      // granted that module's role explicitly (via /admin/users). This matches
      // the "roles are earned, not inherited" invariant (spec §4.2).
      core: ['platform_admin', 'staff'],
      events: ['admin'],
      insights: ['admin'],
    },
  },
  {
    id: 'demo-vendor',
    email: 'vendor@acme.demo',
    kind: 'vendor',
    name: 'Acme Medical Supplies',
    title: 'Vendor Portal',
    vendorId: 'ven-acme',
    roles: {
      // External vendor tier: single source of truth in core:vendor_portal
      // (ADR-002 #3; legal:vendor was retired 2026-07-05).
      core: ['vendor_portal'],
    },
  },
];
