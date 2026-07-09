// Human-readable labels + shared formatters for the procurement module.
//
// UX-REVIEW-FULL-APP.md Exec #4 / PR-2 / PR-21 / PR-23 / PR-26: raw enum slugs
// must never render as user copy, and each surface uses exactly ONE date
// convention. Every enum in types.ts gets a complete label map here — the
// completeness is asserted by labels.test.ts so a new enum member fails CI
// until it gets a label.

import type {
  ApprovalStepStatus,
  ProcurementVendor,
  PurchaseOrderStatus,
  RequestAttachmentKind,
  RequestStatus,
} from './types';

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function statusLabel(s: RequestStatus): string {
  return REQUEST_STATUS_LABEL[s];
}

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  issued: 'Issued',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function poStatusLabel(s: PurchaseOrderStatus): string {
  return PO_STATUS_LABEL[s];
}

export const STEP_STATUS_LABEL: Record<ApprovalStepStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  skipped: 'Skipped',
};

export function stepStatusLabel(s: ApprovalStepStatus): string {
  return STEP_STATUS_LABEL[s];
}

/** Vendor accreditation status → human copy (PR-26: no `(renewal_due)`). */
export const ACCREDITATION_LABEL: Record<
  ProcurementVendor['accreditationStatus'],
  string
> = {
  draft: 'Not yet accredited',
  submitted: 'Accreditation under review',
  under_review: 'Accreditation under review',
  approved: 'Accredited',
  provisional: 'Provisional clearance',
  rejected: 'Accreditation rejected',
  expired: 'Accreditation expired',
  renewal_due: 'Accreditation renewal due',
};

export function accreditationLabel(
  s: ProcurementVendor['accreditationStatus'],
): string {
  return ACCREDITATION_LABEL[s];
}

/** Attachment kind → picker/checklist copy (PR-19). */
export const ATTACHMENT_KIND_LABEL: Record<RequestAttachmentKind, string> = {
  spec: 'Technical spec',
  budget: 'Budget evidence',
  previous_cost: 'Previous purchase cost',
  quote: 'Quote / proposal',
  award_recommendation: 'Award Recommendation draft',
  justification: 'Direct-award justification',
  bond: 'Bond / insurance plan',
  brochure: 'Brochure',
  other: 'Other',
};

export function attachmentKindLabel(k: RequestAttachmentKind | undefined): string {
  return ATTACHMENT_KIND_LABEL[k ?? 'other'];
}

// ---------------------------------------------------------------------------
// Date convention (PR-21 / Exec #4): dates are `dateStyle: 'medium'`,
// timestamps are medium date + short time (minute precision — never seconds).
// ---------------------------------------------------------------------------

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
