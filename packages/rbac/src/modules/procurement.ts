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
      capabilities: [
        'view_dashboard',
        'create_request',
        'manage_rfp',
        'author_po',
        'manage_vendors',
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
      capabilities: ['view_dashboard', 'view_finance'],
    },
    admin: {
      label: 'Procurement Admin',
      description: 'Full procurement administration (provisional superset).',
      provisional: true,
      capabilities: [...PROCUREMENT_CAPABILITIES],
    },
  },
};
