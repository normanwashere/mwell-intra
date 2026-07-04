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
    id: 'demo-admin',
    email: 'admin@mwell.demo',
    kind: 'employee',
    name: 'Patricia Lim',
    title: 'Platform Administrator',
    roles: {
      core: ['platform_admin', 'staff'],
      warehouse: ['logistics_supervisor'],
      procurement: ['admin'],
      legal: ['admin'],
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
      core: ['vendor_portal'],
      legal: ['vendor'],
    },
  },
];
