import type { ModuleDefinition } from '../contracts';

// ⚠️ PROVISIONAL — Legal module RBAC starter set (incl. external vendor tier).
// TODO(step 3b/3c): Replace/expand once the accreditation-case + vendor-portal
// MVP is designed. The `vendor` role is the EXTERNAL tier (spec §5): vendors are
// `kind='vendor'` profiles whose RLS scopes every row to their own vendor_id.
//
// ⚠️ RECONCILE IN STEP 3 with the core schema seed (supabase/migrations/
// *core_seed_rbac.sql): the core schema currently models the external tier as
// `core:vendor_portal` with `submit_documents` (what the register_document RPC
// gates on), whereas this module uses `legal:vendor` with `upload_document`.
// Pick one home for the vendor tier and align the cap name to the RPC gate.

export type LegalCapability =
  | 'view_dashboard'
  | 'review_accreditation'
  | 'manage_checklist'
  | 'approve_accreditation'
  | 'manage_documents'
  | 'admin'
  // vendor-tier (external portal) capabilities:
  | 'submit_accreditation'
  | 'upload_document'
  | 'view_own_accreditation';

export type LegalRole = 'legal_reviewer' | 'compliance' | 'admin' | 'vendor';

const LEGAL_CAPABILITIES = [
  'view_dashboard',
  'review_accreditation',
  'manage_checklist',
  'approve_accreditation',
  'manage_documents',
  'admin',
  'submit_accreditation',
  'upload_document',
  'view_own_accreditation',
] as const satisfies readonly LegalCapability[];

export const legalModule: ModuleDefinition<'legal', LegalRole, LegalCapability> = {
  module: 'legal',
  label: 'Legal',
  provisional: true,
  capabilities: LEGAL_CAPABILITIES,
  roles: {
    legal_reviewer: {
      label: 'Legal Reviewer',
      description: 'Reviews accreditation cases and manages requirement checklists.',
      provisional: true,
      capabilities: [
        'view_dashboard',
        'review_accreditation',
        'manage_checklist',
        'manage_documents',
      ],
    },
    compliance: {
      label: 'Compliance',
      description: 'Approves accreditation status and owns the vendor lifecycle.',
      provisional: true,
      capabilities: [
        'view_dashboard',
        'review_accreditation',
        'approve_accreditation',
        'manage_documents',
      ],
    },
    admin: {
      label: 'Legal Admin',
      description: 'Full internal legal administration (provisional superset).',
      provisional: true,
      capabilities: [
        'view_dashboard',
        'review_accreditation',
        'manage_checklist',
        'approve_accreditation',
        'manage_documents',
        'admin',
      ],
    },
    vendor: {
      label: 'Vendor (external)',
      description:
        'External vendor tier: submit accreditation & upload documents for own vendor only.',
      provisional: true,
      capabilities: [
        'submit_accreditation',
        'upload_document',
        'view_own_accreditation',
      ],
    },
  },
};
