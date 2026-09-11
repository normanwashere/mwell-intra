import { describe, expect, it } from 'vitest';
import type { ProcurementRequest, PurchaseOrder } from './types';
import { purchaseOrderWorkflowSummary, requestWorkflowSummary } from './workflowSummary';

const gate = { allowed: true, blockers: [] };
describe('request workflow summary', () => {
  it.each(['cancelled', 'rejected', 'draft', 'submitted', 'under_review', 'approved', 'unexpected'])('describes %s without assuming an assignee', status => {
    const summary = requestWorkflowSummary({ status: status as ProcurementRequest['status'] }, gate, false);
    expect(summary.status).toBeTruthy();
    expect(summary.owner).toBeTruthy();
    expect(summary.nextStep).toBeTruthy();
  });
  it('retains blockers and the requester/Procurement distinction', () => {
    expect(requestWorkflowSummary({ status: 'draft' }, { allowed: false, blockers: ['Department', 'Route confirmation'] }, false))
      .toMatchObject({ owner: 'Procurement / requester', blocker: 'Department; Route confirmation', tone: 'warning' });
    expect(requestWorkflowSummary({ status: 'draft', compliance: { routeConfirmed: true } }, gate, false).owner).toBe('Requester');
  });
  it('uses the first pending tier without claiming a named assignee or reordering the record', () => {
    const approvalSteps: NonNullable<ProcurementRequest['approvalSteps']> = [
      { id: 'later', order: 2, tier: 'finance', status: 'pending' },
      { id: 'first', order: 1, tier: 'dept_head', status: 'pending', label: 'Department head' },
    ];
    expect(requestWorkflowSummary({ status: 'under_review', approvalSteps }, gate, false).owner).toBe('Department head review');
    expect(approvalSteps[0]?.id).toBe('later');
    expect(requestWorkflowSummary({ status: 'under_review' }, gate, false).blocker).toContain('No pending approval step');
  });
  it('points an approved request to its existing PO without declaring downstream readiness', () => {
    expect(requestWorkflowSummary({ status: 'approved' }, gate, true).nextStep).toContain('linked purchase order');
    expect(requestWorkflowSummary({ status: 'rejected' }, gate, true).owner).toBe('Requester');
  });
});

describe('purchase order workflow summary', () => {
  it.each(['closed', 'cancelled'])('preserves terminal %s even when policy reads fail', status => {
    const summary = purchaseOrderWorkflowSummary({ status: status as PurchaseOrder['status'] }, { prerequisiteError: 'Read failed' });
    expect(summary.owner).toBe(status === 'closed' ? 'Procurement / Finance' : 'No further PO action');
    expect(summary.nextStep).not.toContain('Retry');
  });
  it('does not equate a closed PO with settlement when the payment pack is missing', () => {
    const summary = purchaseOrderWorkflowSummary({ status: 'closed' });
    expect(summary).toMatchObject({ status: 'Closed', owner: 'Procurement / Finance', blocker: 'Payment status is unavailable.', tone: 'warning' });
    expect(summary.nextStep).toContain('PO closure does not confirm settlement');
  });
  it.each(['ready_for_finance', 'accepted'])('retains Finance follow-up for closed POs with %s evidence', status => {
    const paymentReadiness = { status } as PurchaseOrder['paymentReadiness'];
    const summary = purchaseOrderWorkflowSummary({ status: 'closed', paymentReadiness });
    expect(summary).toMatchObject({ status: 'Closed', owner: 'Finance', tone: 'warning' });
    expect(summary.nextStep).toContain('do not authorize payment release');
  });
  it.each(['returned', 'superseded', 'draft'])('retains payment correction for a closed PO with %s evidence', status => {
    expect(purchaseOrderWorkflowSummary({ status: 'closed', paymentReadiness: { status } as PurchaseOrder['paymentReadiness'] }))
      .toMatchObject({ status: 'Closed', owner: 'Procurement / Finance', tone: 'warning' });
  });
  it('keeps stale payment evidence visible after PO closure', () => {
    const summary = purchaseOrderWorkflowSummary({ status: 'closed', paymentReadiness: { status: 'accepted', evidenceStale: true, financeNote: 'Acceptance evidence changed' } as PurchaseOrder['paymentReadiness'] });
    expect(summary).toMatchObject({ status: 'Closed', owner: 'Procurement / Finance', blocker: 'Acceptance evidence changed', tone: 'warning' });
  });
  it('uses a known outstanding payment amount even when the pack says released', () => {
    const paymentReadiness = { status: 'released', invoiceAmount: 100, releasedAmount: 40 } as PurchaseOrder['paymentReadiness'];
    expect(purchaseOrderWorkflowSummary({ status: 'closed', paymentReadiness }))
      .toMatchObject({ status: 'Closed', owner: 'Finance', blocker: 'The recorded invoice amount exceeds the recorded released amount.' });
    expect(purchaseOrderWorkflowSummary({ status: 'closed', paymentReadiness: { ...paymentReadiness!, releasedAmount: undefined } }).tone).not.toBe('success');
  });
  it('does not infer commitment readiness from empty or missing data', () => {
    expect(purchaseOrderWorkflowSummary({ status: 'approved' }, { prerequisiteBlockers: [] }))
      .toMatchObject({ blocker: 'Commitment readiness is not verified.', tone: 'warning' });
    expect(purchaseOrderWorkflowSummary({ status: 'issued' }).blocker).toContain('completion is not verified');
  });
  it('surfaces read errors and explicit blockers before action guidance', () => {
    expect(purchaseOrderWorkflowSummary({ status: 'draft' }, { prerequisiteError: 'Policy read failed' }))
      .toMatchObject({ status: 'Readiness unavailable', blocker: 'Policy read failed' });
    expect(purchaseOrderWorkflowSummary({ status: 'approved' }, { prerequisiteBlockers: ['Vendor eligibility unavailable'] }).blocker).toBe('Vendor eligibility unavailable');
  });
  it('retains issued status on a readiness read failure without suggesting approval or reissue', () => {
    const summary = purchaseOrderWorkflowSummary({ status: 'issued' }, { prerequisiteError: 'Read failed' });
    expect(summary.status).toBe('Issued / readiness unavailable');
    expect(summary.nextStep).toContain('verify the current handoff');
    expect(summary.nextStep).not.toMatch(/before approval|before.*issue|reissue/i);
  });
  it('prioritizes outstanding receiving over a generic closure blocker', () => {
    const po = { status: 'issued', lifecycle: { closureStatus: 'blocked' }, receiptStatus: { outstandingQuantity: 4 } } as PurchaseOrder;
    expect(purchaseOrderWorkflowSummary(po)).toMatchObject({ status: 'Receiving incomplete', owner: 'Warehouse / Procurement' });
  });
  it('prioritizes pending vendor acknowledgement over a generic closure blocker', () => {
    const po = { status: 'issued', lifecycle: { closureStatus: 'blocked', acknowledgementStatus: 'pending' }, receiptStatus: { outstandingQuantity: 4 } } as PurchaseOrder;
    expect(purchaseOrderWorkflowSummary(po).owner).toBe('Vendor / Procurement follow-up');
  });
  it('keeps partial receiving visible alongside accepted payment evidence without authorizing release', () => {
    const po = { status: 'issued', lifecycle: { closureStatus: 'blocked' }, receiptStatus: { outstandingQuantity: 4 }, paymentReadiness: { status: 'accepted' } } as PurchaseOrder;
    expect(purchaseOrderWorkflowSummary(po)).toMatchObject({ status: 'Receiving incomplete', owner: 'Warehouse / Finance', blocker: '4 units are not yet QC accepted.' });
    expect(purchaseOrderWorkflowSummary(po).nextStep).toContain('does not authorize release');
  });
  it('prioritizes recorded QC and payment review work over generic closure blockers', () => {
    const po = { status: 'issued', lifecycle: { closureStatus: 'blocked' }, receiptStatus: { outstandingQuantity: 0, rejectedOrQuarantinedQuantity: 2 } } as PurchaseOrder;
    expect(purchaseOrderWorkflowSummary(po).status).toBe('Receipt quality exception');
    expect(purchaseOrderWorkflowSummary({ ...po, receiptStatus: undefined, paymentReadiness: { status: 'ready_for_finance' } as PurchaseOrder['paymentReadiness'] }).owner).toBe('Finance reviewer');
  });
  it.each(['draft', 'pending_approval', 'approved'])('requires explicit ready data for %s guidance', status => {
    const commitmentReadiness = { ready: true, blockers: [] } as unknown as PurchaseOrder['commitmentReadiness'];
    expect(purchaseOrderWorkflowSummary({ status: status as PurchaseOrder['status'], commitmentReadiness }).blocker).toBeUndefined();
  });
  it.each(['returned', 'superseded', 'accepted', 'ready_for_finance'])('describes observable payment state %s', status => {
    const paymentReadiness = { status } as PurchaseOrder['paymentReadiness'];
    const summary = purchaseOrderWorkflowSummary({ status: 'issued', paymentReadiness });
    expect(summary.owner).toContain('Finance');
    expect(summary.nextStep).toMatch(/payment|release/);
  });
  it('prioritizes stale evidence and an independently pending closure', () => {
    const po = { status: 'issued', paymentReadiness: { status: 'accepted', evidenceStale: true } } as PurchaseOrder;
    expect(purchaseOrderWorkflowSummary(po).tone).toBe('warning');
    expect(purchaseOrderWorkflowSummary(po, { closurePending: true }).owner).toBe('Independent final approver');
  });
  it.each([
    [{ closureStatus: 'ready' }, 'Closure ready for request'],
    [{ closureStatus: 'blocked' }, 'Closure blocked'],
    [{ acknowledgementStatus: 'overdue' }, 'Awaiting vendor acknowledgement'],
    [{ qualityRecoveryStatus: 'payment_hold' }, 'Quality recovery open'],
  ])('describes the recorded lifecycle %j', (lifecycle, status) => {
    expect(purchaseOrderWorkflowSummary({ status: 'issued', lifecycle: { qualityRecoveryStatus: 'none', ...lifecycle } as PurchaseOrder['lifecycle'] }).status).toBe(status);
  });
  it('does not treat an unknown status as an actionable draft', () => {
    expect(purchaseOrderWorkflowSummary({ status: 'future' as PurchaseOrder['status'] }).status).toBe('Status unrecognized');
  });
});
