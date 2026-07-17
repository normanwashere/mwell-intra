import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

import { PaymentReadinessPanel } from './PaymentReadinessPanel';
import type { AcceptancePack, PaymentReadinessPack } from '../types';

it('enables Finance preparation when the preview binds every active acceptance and aggregate quantity', () => {
  const acceptances: AcceptancePack[] = [
    { id: 'accept-1', purchaseOrderId: 'po-1', acceptanceType: 'goods', acceptedScope: 'Receipt one', exceptions: [], acceptedAt: '2026-07-15T08:00:00Z', status: 'accepted' },
    { id: 'accept-2', purchaseOrderId: 'po-1', acceptanceType: 'goods', acceptedScope: 'Receipt two', exceptions: [], acceptedAt: '2026-07-15T09:00:00Z', status: 'accepted' },
  ];
  const pack: PaymentReadinessPack = {
    id: 'pack-1', purchaseOrderId: 'po-1', acceptancePackId: 'accept-1',
    acceptancePackIds: ['accept-1', 'accept-2'], acceptedQuantity: 7,
    poMatch: true, invoiceOrSiReference: 'invoice-1', milestoneSupportReference: 'delivery-1',
    taxWithholdingSupportReference: 'tax-1', status: 'draft', preparedAt: '2026-07-15T10:00:00Z',
  };

  const html = renderToStaticMarkup(createElement(PaymentReadinessPanel, {
    acceptances, pack, canAccept: false, canPrepare: true, canReview: false,
    onAccept: vi.fn(), onPrepare: vi.fn(), onReview: vi.fn(),
  }));

  expect(html).toContain('2 active acceptance packs');
  expect(html).toContain('7 accepted unit');
  expect(html).toMatch(/<button[^>]*>[^<]*(?:<[^>]+>)*Send to Finance/);
  expect(html).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*(?:<[^>]+>)*Send to Finance/);
});

it('sums acceptance quantities before a pack exists and keeps immutable staleness history visible after replacement', () => {
  const acceptances: AcceptancePack[] = [
    { id: 'accept-1', purchaseOrderId: 'po-1', acceptanceType: 'goods', acceptedScope: 'Receipt one', acceptedQuantity: 3, exceptions: [], acceptedAt: '2026-07-15T08:00:00Z', status: 'accepted' },
    { id: 'accept-2', purchaseOrderId: 'po-1', acceptanceType: 'goods', acceptedScope: 'Receipt two', acceptedQuantity: 4, exceptions: [], acceptedAt: '2026-07-15T09:00:00Z', status: 'accepted' },
  ];
  const pack: PaymentReadinessPack = {
    id: 'replacement', purchaseOrderId: 'po-1', acceptancePackId: 'accept-1',
    acceptancePackIds: ['accept-1', 'accept-2'], acceptedQuantity: 7,
    poMatch: true, invoiceOrSiReference: 'invoice-2', milestoneSupportReference: 'delivery-2',
    taxWithholdingSupportReference: 'tax-2', status: 'ready_for_finance', preparedAt: '2026-07-15T12:00:00Z',
    correctedFrom: 'finalized-stale-pack',
  };
  const html = renderToStaticMarkup(createElement(PaymentReadinessPanel, {
    acceptances, pack,
    stalenessEvents: [{
      id: 'event-1', paymentReadinessPackId: 'finalized-stale-pack', purchaseOrderId: 'po-1',
      priorStatus: 'accepted', priorAcceptanceEvidenceVersion: 1, acceptanceEvidenceVersion: 2,
      reason: 'Later acceptance evidence', recordedAt: '2026-07-15T11:00:00Z',
      financeReviewedByEmail: 'finance.reviewer@mwell.com.ph',
      financeReviewedAt: '2026-07-15T10:30:00Z', financeNote: 'Accepted after three-way match.',
    }],
    canAccept: false, canPrepare: true, canReview: true,
    onAccept: vi.fn(), onPrepare: vi.fn(), onReview: vi.fn(),
  }));
  expect(html).toContain('7 accepted unit');
  expect(html).toContain('Finance evidence staleness history');
  expect(html).toContain('Evidence v1 to v2');
  expect(html).toContain('Prior decision: Accepted');
  expect(html).toContain('finance.reviewer@mwell.com.ph');
  expect(html).toContain('Accepted after three-way match.');
  expect(html).toContain('Replacement for finalized-stale-pack');
});
