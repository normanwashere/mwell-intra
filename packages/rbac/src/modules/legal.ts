import type { ModuleDefinition } from '../contracts';

// Legal module RBAC — internal accreditation review only. The external vendor
// tier lives in @intra/rbac core (core:vendor_portal with submit_documents +
// submit_accreditation + view_own_accreditation). RECONCILED 2026-07-05: the
// provisional `legal:vendor` role and its upload_document/submit_accreditation
// caps were retired (see supabase/migrations/20260706150000_vendor_tier_reconcile.sql).

export type LegalCapability =
  | 'view_dashboard'
  | 'review_accreditation'
  | 'manage_checklist'
  | 'approve_accreditation'
  | 'manage_documents'
  | 'admin';

export type LegalRole = 'legal_reviewer' | 'compliance' | 'admin';

const LEGAL_CAPABILITIES = [
  'view_dashboard',
  'review_accreditation',
  'manage_checklist',
  'approve_accreditation',
  'manage_documents',
  'admin',
] as const satisfies readonly LegalCapability[];

export const legalModule: ModuleDefinition<'legal', LegalRole, LegalCapability> = {
  module: 'legal',
  label: 'Legal',
  capabilities: LEGAL_CAPABILITIES,
  roles: {
    legal_reviewer: {
      label: 'Legal Reviewer',
      description: 'Reviews accreditation cases and manages requirement checklists.',
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
      capabilities: [
        'view_dashboard',
        'review_accreditation',
        'approve_accreditation',
        'manage_documents',
      ],
    },
    admin: {
      label: 'Legal Admin',
      description: 'Full internal legal administration.',
      capabilities: [
        'view_dashboard',
        'review_accreditation',
        'manage_checklist',
        'approve_accreditation',
        'manage_documents',
        'admin',
      ],
    },
  },
};
