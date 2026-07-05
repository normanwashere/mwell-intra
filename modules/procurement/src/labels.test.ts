import { describe, expect, it } from 'vitest';
import {
  ACCREDITATION_LABEL,
  ATTACHMENT_KIND_LABEL,
  PO_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  STEP_STATUS_LABEL,
  accreditationLabel,
  attachmentKindLabel,
  formatDate,
  formatDateTime,
  poStatusLabel,
  statusLabel,
  stepStatusLabel,
} from './labels';
import type {
  ApprovalStepStatus,
  PurchaseOrderStatus,
  RequestAttachmentKind,
  RequestStatus,
} from './types';

// Compile-time exhaustiveness is enforced by the Record<> types; these specs
// assert the runtime shape too (every member present, humanized, no slugs).

const REQUEST_STATUSES: RequestStatus[] = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'cancelled',
];

const PO_STATUSES: PurchaseOrderStatus[] = [
  'draft',
  'pending_approval',
  'approved',
  'issued',
  'closed',
  'cancelled',
];

const STEP_STATUSES: ApprovalStepStatus[] = [
  'pending',
  'approved',
  'rejected',
  'skipped',
];

const ATTACHMENT_KINDS: RequestAttachmentKind[] = [
  'budget',
  'previous_cost',
  'spec',
  'quote',
  'award_recommendation',
  'justification',
  'bond',
  'brochure',
  'other',
];

describe('status label maps (Exec #4 / PR-2 — no raw slugs)', () => {
  it('covers every RequestStatus with a humanized label', () => {
    for (const s of REQUEST_STATUSES) {
      const label = statusLabel(s);
      expect(label, `label for ${s}`).toBeTruthy();
      expect(label).not.toMatch(/_/);
      expect(label[0]).toBe(label[0]!.toUpperCase());
    }
    expect(Object.keys(REQUEST_STATUS_LABEL)).toHaveLength(REQUEST_STATUSES.length);
  });

  it('maps under_review → "Under review" (the review\'s canonical example)', () => {
    expect(statusLabel('under_review')).toBe('Under review');
  });

  it('covers every PurchaseOrderStatus with a humanized label', () => {
    for (const s of PO_STATUSES) {
      const label = poStatusLabel(s);
      expect(label, `label for ${s}`).toBeTruthy();
      expect(label).not.toMatch(/_/);
    }
    expect(Object.keys(PO_STATUS_LABEL)).toHaveLength(PO_STATUSES.length);
    expect(poStatusLabel('pending_approval')).toBe('Pending approval');
  });

  it('covers every ApprovalStepStatus', () => {
    for (const s of STEP_STATUSES) {
      expect(stepStatusLabel(s), `label for ${s}`).toBeTruthy();
    }
    expect(Object.keys(STEP_STATUS_LABEL)).toHaveLength(STEP_STATUSES.length);
  });

  it('covers every accreditation status with human copy (PR-26)', () => {
    for (const s of Object.keys(ACCREDITATION_LABEL)) {
      const label = accreditationLabel(s as keyof typeof ACCREDITATION_LABEL);
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/_/);
    }
    expect(accreditationLabel('renewal_due')).toBe('Accreditation renewal due');
  });

  it('covers every attachment kind (PR-19 checklist matching)', () => {
    for (const k of ATTACHMENT_KINDS) {
      expect(attachmentKindLabel(k), `label for ${k}`).toBeTruthy();
    }
    expect(Object.keys(ATTACHMENT_KIND_LABEL)).toHaveLength(ATTACHMENT_KINDS.length);
    expect(attachmentKindLabel(undefined)).toBe('Other');
  });
});

describe('date formatters (PR-21 — one convention, minute precision)', () => {
  it('formatDate renders a medium date without a time component', () => {
    const out = formatDate('2026-07-05T14:08:11.000Z');
    expect(out).toBeTruthy();
    expect(out).not.toMatch(/:/);
  });

  it('formatDateTime renders minute precision (no seconds)', () => {
    const out = formatDateTime('2026-07-05T14:08:11.000Z');
    // "Jul 5, 2026, 10:08 PM"-style: exactly one colon → minutes, no seconds.
    expect(out.match(/:/g)).toHaveLength(1);
  });

  it('both return an em dash for invalid input', () => {
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});
