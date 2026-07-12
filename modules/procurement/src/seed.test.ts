import { describe, expect, it } from 'vitest';
import { buildProcurementSeed } from './seed';
import { nextPendingStep } from './policy';

const NOW = new Date('2026-07-06T12:00:00.000Z');

describe('buildProcurementSeed', () => {
  const seed = buildProcurementSeed(NOW);

  it('seeds a full spread of request states', () => {
    const byStatus = (s: string) => seed.requests.filter((r) => r.status === s);
    expect(seed.requests.length).toBeGreaterThanOrEqual(12);
    expect(byStatus('draft').length).toBeGreaterThanOrEqual(2);
    expect(byStatus('submitted').length).toBeGreaterThanOrEqual(2);
    expect(byStatus('under_review').length).toBeGreaterThanOrEqual(3);
    expect(byStatus('approved').length).toBeGreaterThanOrEqual(4);
    expect(byStatus('rejected').length).toBe(1);
  });

  it('builds valid ladders — decided steps precede pending ones', () => {
    for (const req of seed.requests) {
      if (!req.approvalSteps) continue;
      const ordered = [...req.approvalSteps].sort((a, b) => a.order - b.order);
      let seenPending = false;
      for (const step of ordered) {
        if (step.status === 'pending') seenPending = true;
        else if (seenPending && step.status !== 'skipped') {
          throw new Error(
            `Request ${req.id}: decided step after a pending one (${step.tier})`,
          );
        }
      }
    }
  });

  it('under_review requests stop at the expected tiers', () => {
    const cebu = seed.requests.find((r) => r.title.startsWith('Clinic fit-out'));
    expect(cebu?.status).toBe('under_review');
    expect(nextPendingStep(cebu?.approvalSteps)?.tier).toBe('legal');

    const nurses = seed.requests.find((r) => r.title.startsWith('Nurse staffing'));
    expect(nextPendingStep(nurses?.approvalSteps)?.tier).toBe('finance');

    const telehealth = seed.requests.find((r) => r.title.startsWith('Telehealth platform'));
    expect(nextPendingStep(telehealth?.approvalSteps)?.tier).toBe('final_approver');
  });

  it('every approved step carries a signature; rejection carries a note', () => {
    for (const req of seed.requests) {
      for (const step of req.approvalSteps ?? []) {
        if (step.status === 'approved') {
          expect(step.signature?.dataUrl).toMatch(/^data:image\/svg\+xml/);
          expect(step.signature?.signerName).toBeTruthy();
        }
      }
    }
    const rejected = seed.requests.find((r) => r.status === 'rejected');
    expect(rejected?.decisionNote).toBeTruthy();
  });

  it('records an approval-history row per decided step', () => {
    const decidedSteps = seed.requests.flatMap(
      (r) => (r.approvalSteps ?? []).filter((s) => s.status !== 'pending' && s.status !== 'skipped'),
    );
    const requestDecisions = seed.approvals.filter((a) => a.entityType === 'request');
    expect(requestDecisions.length).toBe(decidedSteps.length);
    for (const d of requestDecisions) {
      expect(seed.requests.some((r) => r.id === d.entityId)).toBe(true);
    }
  });

  it('seeds POs across the full status spread', () => {
    const statuses = new Set(seed.purchaseOrders.map((p) => p.status));
    for (const s of ['draft', 'pending_approval', 'approved', 'issued', 'closed', 'cancelled']) {
      expect(statuses.has(s as never)).toBe(true);
    }
    expect(seed.purchaseOrders.length).toBeGreaterThanOrEqual(8);
  });

  it('partial receipt: received < ordered with receipt history attached', () => {
    const partial = seed.purchaseOrders.find(
      (p) => p.status === 'issued' && p.lines.some((l) => l.receivedQuantity > 0),
    );
    expect(partial).toBeDefined();
    const line = partial!.lines.find((l) => l.receivedQuantity > 0)!;
    expect(line.receivedQuantity).toBeLessThan(line.quantity);
    expect(partial!.receipts?.length).toBeGreaterThanOrEqual(1);
    expect(partial!.receipts![0]!.closedPo).toBe(false);
  });

  it('closed PO is fully received and its receipt closes it', () => {
    const closed = seed.purchaseOrders.find((p) => p.status === 'closed');
    expect(closed).toBeDefined();
    for (const l of closed!.lines) expect(l.receivedQuantity).toBe(l.quantity);
    expect(closed!.receipts?.some((r) => r.closedPo)).toBe(true);
  });

  it('PO-linked requests exist and are approved', () => {
    for (const po of seed.purchaseOrders) {
      if (!po.requestId) continue;
      const req = seed.requests.find((r) => r.id === po.requestId);
      expect(req, `PO ${po.poNumber} links to a missing request`).toBeDefined();
      expect(req!.status).toBe('approved');
    }
  });

  it('po numbers are unique and follow the PO-YYYY-NNNN format', () => {
    const numbers = seed.purchaseOrders.map((p) => p.poNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(n).toMatch(/^PO-\d{4}-\d{4}$/);
  });

  it('totals equal the sum of line quantities times unit prices', () => {
    for (const req of seed.requests) {
      const expected = req.lines.reduce((s, l) => s + l.quantity * (l.unitPrice ?? 0), 0);
      expect(req.estimatedAmount).toBe(expected);
    }
    for (const po of seed.purchaseOrders) {
      const expected = po.lines.reduce((s, l) => s + l.quantity * (l.unitPrice ?? 0), 0);
      expect(po.total).toBe(expected);
    }
  });

  it('all dates are in the past (relative to now) and ISO-formatted', () => {
    const nowMs = NOW.getTime();
    for (const req of seed.requests) {
      expect(new Date(req.createdAt).getTime()).toBeLessThanOrEqual(nowMs);
      if (req.submittedAt) {
        expect(new Date(req.submittedAt).getTime()).toBeLessThanOrEqual(nowMs);
      }
    }
    for (const po of seed.purchaseOrders) {
      expect(new Date(po.createdAt).getTime()).toBeLessThanOrEqual(nowMs);
    }
  });

  it('is deterministic for a fixed now', () => {
    const again = buildProcurementSeed(NOW);
    expect(again).toEqual(seed);
  });
});
