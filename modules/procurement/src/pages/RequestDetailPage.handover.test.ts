import { describe, expect, it } from 'vitest';
import type { ApprovalStep } from '../types';
import { requestSubmissionSuccessMessage } from './RequestDetailPage';

describe('request submission success handover', () => {
  it('uses the earliest pending returned step, never the previous actor', () => {
    const approvalSteps: ApprovalStep[] = [
      { id: 'later', order: 3, tier: 'finance', label: 'Finance', status: 'pending' },
      { id: 'done', order: 1, tier: 'dept_head', label: 'Department head', status: 'approved', decidedByEmail: 'previous.actor@example.test' },
      { id: 'next', order: 2, tier: 'procurement_head', label: 'Procurement', status: 'pending' },
    ];
    const before = structuredClone(approvalSteps);
    const message = requestSubmissionSuccessMessage({ status: 'under_review', approvalSteps });
    expect(message).toContain('Request status recorded: Under review.');
    expect(message).toContain('Next: Procurement review.');
    expect(message).toContain('authorized reviewer handles the pending step in the approval inbox');
    expect(message).not.toMatch(/previous.actor|Next: Finance/);
    expect(approvalSteps).toEqual(before);
  });

  it('asks Procurement to verify routing when no pending step is returned', () => {
    const message = requestSubmissionSuccessMessage({ status: 'submitted', approvalSteps: [] });
    expect(message).toContain('Request status recorded: Submitted.');
    expect(message).toContain('Next: Procurement. Verify the current approval routing');
    expect(message).not.toContain('authorized reviewer handles');
  });

  it.each([false, true])('honors an approved result and linked PO presence (%s)', hasLinkedPo => {
    const message = requestSubmissionSuccessMessage({ status: 'approved', approvalSteps: [] }, hasLinkedPo);
    expect(message).toContain('Request status recorded: Approved. Next: Procurement.');
    expect(message).toContain(hasLinkedPo ? 'Review the linked purchase order' : 'Review the approved request and vendor before authoring');
    expect(message).not.toMatch(/submitted|pending step/i);
  });
});
