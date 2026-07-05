import type { ModuleDefinition } from '../contracts';

// ⚠️ PROVISIONAL — Procurement module RBAC starter set.
// TODO(step 3a): Replace/expand once the procurement MVP (requests → RFP → PO
// authoring → approvals; award gated on vendor accreditation) is designed.
// Keep small and in sync with `core.role_capabilities` when it firms up.

export type ProcurementCapability =
  | 'view_dashboard'
  | 'create_request'
  | 'manage_rfp'
  | 'author_po'
  | 'approve_request'
  | 'approve_award'
  | 'manage_vendors'
  | 'view_finance'
  | 'admin';

export type ProcurementRole =
  | 'requester'
  | 'procurement_officer'
  | 'approver'
  | 'finance'
  | 'admin';

const PROCUREMENT_CAPABILITIES = [
  'view_dashboard',
  'create_request',
  'manage_rfp',
  'author_po',
  'approve_request',
  'approve_award',
  'manage_vendors',
  'view_finance',
  'admin',
] as const satisfies readonly ProcurementCapability[];

export const procurementModule: ModuleDefinition<
  'procurement',
  ProcurementRole,
  ProcurementCapability
> = {
  module: 'procurement',
  label: 'Procurement',
  provisional: true,
  capabilities: PROCUREMENT_CAPABILITIES,
  roles: {
    requester: {
      label: 'Requester',
      description: 'Raises purchase requests for their business unit.',
      provisional: true,
      capabilities: ['view_dashboard', 'create_request'],
    },
    procurement_officer: {
      label: 'Procurement Officer',
      description: 'Runs RFPs, authors POs, coordinates vendors.',
      provisional: true,
      // approve_request: the officer holds the Procurement Head tier on the
      // approval ladder (policy §3) — sourcing/AR review before Finance/DOA.
      capabilities: [
        'view_dashboard',
        'create_request',
        'manage_rfp',
        'author_po',
        'manage_vendors',
        'approve_request',
      ],
    },
    approver: {
      label: 'Approver',
      description: 'Approves requests and awards within authority limits.',
      provisional: true,
      capabilities: ['view_dashboard', 'approve_request', 'approve_award'],
    },
    finance: {
      label: 'Finance',
      description: 'Reviews commercial terms and spend for payment readiness.',
      provisional: true,
      // approve_request: Finance sits on the multi-tier approval ladder
      // (policy §3/§9) and must be able to open the approval inbox and
      // decide its tier. Mirrored in SQL by 20260707130000.
      capabilities: ['view_dashboard', 'view_finance', 'approve_request'],
    },
    admin: {
      label: 'Procurement Admin',
      description: 'Full procurement administration (provisional superset).',
      provisional: true,
      capabilities: [...PROCUREMENT_CAPABILITIES],
    },
  },
};
