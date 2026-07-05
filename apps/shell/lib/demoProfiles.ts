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
      warehouse: ['logistics_supervisor'],
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
    title: 'Procurement Approver',
    roles: {
      core: ['staff'],
      procurement: ['approver'],
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
