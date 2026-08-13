export type VendorApplicationWorkflowStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'correction_requested'
  | 'approved'
  | 'provisional'
  | 'rejected'
  | 'expired'
  | 'renewal_due';

export interface CorrectionRequest {
  requestedAt: string;
  requestedByEmail?: string;
  note: string;
  sourceVersion: number;
  revision: number;
}

export function canRequestCorrection(status: VendorApplicationWorkflowStatus): boolean {
  return status === 'submitted' || status === 'under_review';
}

export function applicationEditState(
  status: VendorApplicationWorkflowStatus,
  correction?: CorrectionRequest,
): { editable: boolean; label: string; detail?: string } {
  if (status === 'draft') return { editable: true, label: 'Draft revision' };
  if (status === 'correction_requested' && correction) {
    return {
      editable: true,
      label: `Correction revision ${correction.revision}`,
      detail: `Legal requested changes to submitted version ${correction.sourceVersion}: ${correction.note}`,
    };
  }
  if (status === 'submitted' || status === 'under_review') {
    return { editable: false, label: 'Submitted version is read-only' };
  }
  return { editable: false, label: 'This application is read-only' };
}

export function recoverStaleDraft<T>(
  _stale: { version: number; application: T },
  current: { version: number; application: T },
): { recovered: true; version: number; application: T; message: string } {
  return {
    recovered: true,
    version: current.version,
    application: current.application,
    message: 'This application changed elsewhere. The latest version has been loaded; review it before editing again.',
  };
}

export type LifecycleReviewType =
  | 'renewal'
  | 'document_expiry'
  | 'performance'
  | 'reassessment'
  | 'suspension'
  | 'offboarding'
  | 'reinstatement';

export type LifecycleReviewStatus =
  | 'open'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled';

export function lifecyclePresentation(
  reviewType: LifecycleReviewType,
  status: LifecycleReviewStatus,
): { label: string; detail: string } {
  const subject: Record<LifecycleReviewType, string> = {
    renewal: 'Renewal',
    document_expiry: 'Document-expiry review',
    performance: 'Performance review',
    reassessment: 'Reassessment',
    suspension: 'Suspension',
    offboarding: 'Offboarding',
    reinstatement: 'Reinstatement review',
  };
  const outcome: Record<LifecycleReviewStatus, string> = {
    open: 'open',
    under_review: 'under review',
    approved: 'approved',
    rejected: 'rejected',
    completed: 'completed',
    cancelled: 'cancelled',
  };
  const label = `${subject[reviewType]} ${outcome[status]}`;
  const detail = reviewType === 'reinstatement'
    ? 'Reinstatement is not available through the current lifecycle service; start a new governed accreditation review.'
    : reviewType === 'suspension'
      ? 'A completed suspension blocks vendor activity until a new governed decision changes the vendor status.'
      : reviewType === 'offboarding'
        ? 'A completed offboarding disables vendor portal access.'
        : `${subject[reviewType]} remains governed by the current lifecycle review.`;
  return { label, detail };
}
