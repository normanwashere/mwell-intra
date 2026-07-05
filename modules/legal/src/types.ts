// Legal accreditation domain types (preview build). Mirrors what @intra/core-data
// + legal.* RPCs will return once the live adapter lands; kept camelCase.

export type CaseStatus =
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
  status: CaseStatus;
  openedAt: string;
  submittedAt?: string;
  decidedAt?: string;
  decidedByEmail?: string;
  decisionNote?: string;
  /** ISO date the accreditation expires on approval. */
  expiresAt?: string;
  /** Scope of accreditation (e.g. "medical devices, consumables"). */
  scope?: string;
  category?: string;
}

export type ChecklistDecision = 'pending' | 'approved' | 'rejected' | 'na';

export interface RequirementChecklistItem {
  id: string;
  caseId: string;
  requirement: string;
  description?: string;
  required: boolean;
  decision: ChecklistDecision;
  reviewerEmail?: string;
  reviewedAt?: string;
  reviewerNote?: string;
  /** Ids of AccreditationDoc rows attached to this checklist item. */
  documentIds: string[];
}

export type DocumentStatus = 'submitted' | 'approved' | 'rejected' | 'expired';

export interface AccreditationDoc {
  id: string;
  caseId: string;
  vendorId: string;
  requirementId?: string;
  docType: string; // e.g. 'business_permit', 'sec_registration', 'ce_cert'
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** For the demo we inline base64. Live version stores a Storage `path`. */
  dataUrl?: string;
  status: DocumentStatus;
  version: number;
  uploadedAt: string;
  uploadedByEmail?: string;
  expiresAt?: string;
  reviewerNote?: string;
}

export interface CaseTimelineEntry {
  id: string;
  caseId: string;
  at: string;
  actorEmail?: string;
  action: string; // 'created' | 'submitted' | 'doc_uploaded' | 'checklist_decided' | 'approved' | 'rejected' | 'note'
  detail?: string;
}

export interface VendorInvite {
  id: string;
  email: string;
  companyName: string;
  category?: string;
  createdAt: string;
  createdByEmail?: string;
  acceptedAt?: string;
  status: 'sent' | 'accepted' | 'expired';
}
