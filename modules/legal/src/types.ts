export type AccreditationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'renewal_due';

export interface AccreditationCase {
  id: string;
  vendorId: string;
  vendorName: string;
  status: AccreditationStatus;
  submittedAt?: string;
  expiresAt?: string;
}

export type ChecklistItemStatus =
  | 'pending'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'waived';

export interface RequirementChecklistItem {
  id: string;
  caseId: string;
  requirementCode: string;
  label: string;
  status: ChecklistItemStatus;
  required: boolean;
}
