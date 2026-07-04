import type { ModuleDefinition } from '../contracts';

// Core (shared foundation) RBAC. These are the CROSS-CUTTING capabilities that
// the `core` schema's RLS policies and SECURITY DEFINER RPCs gate on (vendor
// master, documents, approvals, activity log, notifications, RBAC admin).
//
// This vocabulary is kept IN SYNC with the core schema migrations
// (supabase/migrations/*core_rbac.sql + *core_seed_rbac.sql). The RPC gates use
// `has_any_cap(cap)` (cross-module), so these core caps are the canonical home
// of the shared-resource permissions; internal employees hold `staff` (baseline
// reads) alongside their module role(s), and `platform_admin` administers.

export type CoreCapability =
  | 'view_directory'
  | 'manage_rbac'
  | 'view_vendors'
  | 'manage_vendors'
  | 'manage_accreditation'
  | 'view_documents'
  | 'manage_documents'
  | 'submit_documents'
  | 'submit_accreditation'
  | 'view_own_accreditation'
  | 'view_approvals'
  | 'manage_approvals'
  | 'record_approval'
  | 'view_audit'
  | 'manage_notifications';

// platform_admin: full foundation administration. staff: baseline reads for
// every internal employee. vendor_portal: EXTERNAL tier (kind='vendor'); no
// broad reads — visibility comes only from vendor_id-scoped RLS branches.
export type CoreRole = 'platform_admin' | 'staff' | 'vendor_portal';

const CORE_CAPABILITIES = [
  'view_directory',
  'manage_rbac',
  'view_vendors',
  'manage_vendors',
  'manage_accreditation',
  'view_documents',
  'manage_documents',
  'submit_documents',
  'submit_accreditation',
  'view_own_accreditation',
  'view_approvals',
  'manage_approvals',
  'record_approval',
  'view_audit',
  'manage_notifications',
] as const satisfies readonly CoreCapability[];

export const coreModule: ModuleDefinition<'core', CoreRole, CoreCapability> = {
  module: 'core',
  label: 'Core',
  capabilities: CORE_CAPABILITIES,
  roles: {
    platform_admin: {
      label: 'Platform Administrator',
      description: 'Manages users, RBAC, and all shared master data + audit.',
      capabilities: [
        'view_directory',
        'manage_rbac',
        'view_vendors',
        'manage_vendors',
        'manage_accreditation',
        'view_documents',
        'manage_documents',
        'view_approvals',
        'manage_approvals',
        'record_approval',
        'view_audit',
        'manage_notifications',
      ],
    },
    staff: {
      label: 'Internal Staff (baseline)',
      description:
        'Baseline read access to shared master data. Assign to every internal employee alongside their module role(s).',
      capabilities: [
        'view_directory',
        'view_vendors',
        'view_documents',
        'view_approvals',
      ],
    },
    vendor_portal: {
      label: 'Vendor Portal User',
      description:
        'External vendor tier: submit accreditation + documents for their own vendor only (RLS-scoped by vendor_id).',
      capabilities: [
        'submit_documents',
        'submit_accreditation',
        'view_own_accreditation',
      ],
    },
  },
};
